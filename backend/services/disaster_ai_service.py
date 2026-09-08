import base64
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

import httpx


logger = logging.getLogger(__name__)


class DisasterAIError(RuntimeError):
    """A safe, user-facing error raised when Gemini cannot answer."""


class DisasterAIService:
    async def analyze(
        self,
        messages: List[Dict[str, str]],
        sensor_context: str,
        image_base64: Optional[str] = None,
    ) -> Dict[str, Any]:
        api_key = os.getenv("GEMINI_API_KEY", "").strip()
        model = os.getenv("GEMINI_MODEL", "gemini-flash-latest").strip()
        if not api_key:
            raise DisasterAIError("伺服器尚未設定 Gemini API Key")

        contents = []
        for message in messages[-30:]:
            contents.append(
                {
                    "role": "user" if message["role"] == "user" else "model",
                    "parts": [{"text": message["content"]}],
                }
            )

        if not contents:
            raise DisasterAIError("對話內容不可為空")

        contents[-1]["parts"][0]["text"] += (
            f"\n\n[系統感測器背景資訊: {sensor_context or '無'}]"
        )
        if image_base64:
            mime_type, encoded = self._parse_image(image_base64)
            contents[-1]["parts"].append(
                {"inlineData": {"mimeType": mime_type, "data": encoded}}
            )

        endpoint = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent"
        )
        payload = {
            "systemInstruction": {"parts": [{"text": self._system_instruction()}]},
            "contents": contents,
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.2,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=35) as client:
                response = await client.post(
                    endpoint,
                    params={"key": api_key},
                    json=payload,
                )
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise DisasterAIError("Gemini 回應逾時，請稍後再試") from exc
        except httpx.HTTPStatusError as exc:
            logger.warning("Gemini HTTP error: %s", exc.response.status_code)
            if exc.response.status_code == 429:
                raise DisasterAIError("Gemini 使用額度或速率已達上限，請稍後再試") from exc
            raise DisasterAIError("Gemini 服務暫時無法使用") from exc
        except httpx.HTTPError as exc:
            raise DisasterAIError("無法連線至 Gemini 服務") from exc

        try:
            text = self._extract_text(response.json())
            return self._normalize(self._parse_json(text))
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            logger.warning("Invalid Gemini disaster response: %s", exc)
            raise DisasterAIError("Gemini 回應格式不正確，請重新送出") from exc

    def _parse_image(self, value: str) -> tuple[str, str]:
        mime_type = "image/jpeg"
        encoded = value
        match = re.match(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", value, re.DOTALL)
        if match:
            mime_type, encoded = match.groups()
        if len(encoded) > 12 * 1024 * 1024:
            raise DisasterAIError("圖片太大，請使用較小的照片")
        try:
            base64.b64decode(encoded, validate=True)
        except ValueError as exc:
            raise DisasterAIError("圖片格式無效") from exc
        return mime_type, encoded

    def _extract_text(self, response: Dict[str, Any]) -> str:
        candidates = response.get("candidates") or []
        if not candidates:
            raise ValueError("Gemini 沒有回傳候選內容")
        parts = candidates[0].get("content", {}).get("parts", [])
        text = "\n".join(part.get("text", "") for part in parts if part.get("text"))
        if not text.strip():
            raise ValueError("Gemini 回應為空")
        return text

    def _parse_json(self, text: str) -> Dict[str, Any]:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", text, re.DOTALL)
            if not match:
                raise
            return json.loads(match.group(0))

    def _normalize(self, data: Dict[str, Any]) -> Dict[str, Any]:
        priorities = {"CRITICAL", "HIGH", "MEDIUM"}
        actions = []
        for item in (data.get("immediateActions") or [])[:8]:
            if not isinstance(item, dict):
                continue
            priority = str(item.get("priority") or "HIGH").upper()
            actions.append(
                {
                    "title": str(item.get("title") or "立即處置"),
                    "description": str(item.get("description") or "請保持冷靜並確認環境安全。"),
                    "priority": priority if priority in priorities else "HIGH",
                }
            )
        if not actions:
            actions.append(
                {
                    "title": "確認安全",
                    "description": "請保持冷靜，遠離立即危險並撥打 119 或 112。",
                    "priority": "CRITICAL",
                }
            )

        summary = data.get("emergencySummary") or {}
        injury_severity = summary.get("injurySeverity", "unknown")
        if injury_severity not in {"unknown", "minor", "moderate", "severe", "critical"}:
            injury_severity = "unknown"
        mobility = summary.get("mobilityStatus", "unknown")
        if mobility not in {"unknown", "mobile", "limited", "immobile"}:
            mobility = "unknown"

        return {
            "type": str(data.get("type") or "UNKNOWN"),
            "riskLevel": self._bounded_int(data.get("riskLevel"), 1, 10, 5),
            "situationSummary": str(data.get("situationSummary") or "已收到您的回報。"),
            "immediateActions": actions,
            "longTermAdvice": str(data.get("longTermAdvice") or "持續留意官方資訊與周遭安全。"),
            "survivalProbability": self._bounded_int(data.get("survivalProbability"), 0, 100, 50),
            "missingInfoRequests": [str(item) for item in (data.get("missingInfoRequests") or [])[:8]],
            "emergencySummary": {
                "hasInjuries": bool(summary.get("hasInjuries", False)),
                "injurySummary": str(summary.get("injurySummary") or ""),
                "injurySeverity": injury_severity,
                "rescueNeeds": [str(item) for item in (summary.get("rescueNeeds") or [])[:10]],
                "isTrapped": bool(summary.get("isTrapped", False)),
                "mobilityStatus": mobility,
                "locationDetails": str(summary.get("locationDetails") or ""),
                "urgencyLevel": self._bounded_int(summary.get("urgencyLevel"), 1, 10, 1),
                "confidence": self._bounded_float(summary.get("confidence"), 0, 1, 0),
            },
        }

    def _bounded_int(self, value: Any, low: int, high: int, default: int) -> int:
        try:
            return max(low, min(high, int(float(value))))
        except (TypeError, ValueError):
            return default

    def _bounded_float(self, value: Any, low: float, high: float, default: float) -> float:
        try:
            return max(low, min(high, float(value)))
        except (TypeError, ValueError):
            return default

    def _system_instruction(self) -> str:
        return """
你是一位災害應變專家 AI。請閱讀完整對話和感測器資料，以繁體中文回覆。
不得把推測當成使用者已確認的事實。一般災情問題直接回答；只有在使用者受困或
受傷時才提供完整救援步驟。若有立即生命危險，提醒撥打 119 或 112。

只回傳 JSON，不要 Markdown，格式如下：
{
  "type": "災害類型",
  "riskLevel": 1,
  "situationSummary": "狀況摘要",
  "immediateActions": [
    {"title": "動作標題", "description": "具體安全動作", "priority": "CRITICAL"}
  ],
  "longTermAdvice": "後續建議",
  "survivalProbability": 50,
  "missingInfoRequests": ["仍需確認的資訊"],
  "emergencySummary": {
    "hasInjuries": false,
    "injurySummary": "",
    "injurySeverity": "unknown",
    "rescueNeeds": [],
    "isTrapped": false,
    "mobilityStatus": "unknown",
    "locationDetails": "",
    "urgencyLevel": 1,
    "confidence": 0
  }
}
priority 只能是 CRITICAL、HIGH、MEDIUM；injurySeverity 只能是 unknown、minor、
moderate、severe、critical；mobilityStatus 只能是 unknown、mobile、limited、immobile。
""".strip()


disaster_ai_service = DisasterAIService()
