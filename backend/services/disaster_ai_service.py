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
        battery_level: Optional[float] = None,
        heart_rate: Optional[int] = None,
        medical_card: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        api_key = os.getenv("GEMINI_API_KEY", "").strip()
        model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash").strip()
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
            # 👈 將 battery_level 與 heart_rate 帶入系統提示詞生成器
            "systemInstruction": {"parts": [{"text": self._system_instruction(battery_level, heart_rate, medical_card)}]},
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
            logger.warning("Gemini HTTP error %s: %s", exc.response.status_code, exc.response.text)
            if exc.response.status_code == 429:
                raise DisasterAIError("Gemini 使用額度或速率已達上限，請稍後再試") from exc
            raise DisasterAIError(f"Gemini 服務連線失敗 (HTTP {exc.response.status_code})") from exc
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

    def _system_instruction(
        self,
        battery_level: Optional[float] = None,
        heart_rate: Optional[int] = None,
        medical_card: Optional[Dict[str, Any]] = None
    ) -> str:
        # 動態建立生理與裝置應對指示
        extra_guidelines = []
        medical_context = ""
        has_pacemaker = False

        # --- 解析醫療卡資訊 ---
        if medical_card:
            devices = medical_card.get("medicalDevices", "")
            chronic = medical_card.get("chronicConditions", "")
            meds = medical_card.get("currentMedications", "")
            allergies = medical_card.get("drugAllergies", "")
            
            # 簡單的關鍵字比對，判斷是否含有心律調節器相關字眼
            if "調節器" in devices or "起搏器" in devices or "pacemaker" in devices.lower():
                has_pacemaker = True

            medical_context = (
                "【使用者緊急醫療卡 (ICE) 資訊】\n"
                f"- 慢性病史: {chronic if chronic else '無/未提供'}\n"
                f"- 目前用藥: {meds if meds else '無/未提供'}\n"
                f"- 體內醫療裝置: {devices if devices else '無/未提供'}\n"
                f"- 藥物/食物過敏: {allergies if allergies else '無/未提供'}\n"
                "💡 指示：若使用者受困或需要逃生，請根據上述病史與用藥，在建議中主動提醒攜帶相關急救藥物（如氣喘藥、胰島素等），並在醫療指引中避開過敏原。\n\n"
            )

        if battery_level is not None:
            if battery_level <= 20:
                extra_guidelines.append(
                    f"⚠️ 當前手機剩餘電量僅有 {battery_level:.0f}%（低電量預警）："
                    "必須在 immediateActions 中新增一個高優先級項（CRITICAL 或 HIGH），專門提供省電建議"
                    "（如：立即調低螢幕亮度、開啟省電模式、關閉背景 App，將剩餘電量留給 SOS 求救與通訊）。"
                    "請預估剩餘電量使用情境並提醒使用者省電。"
                )
            else:
                extra_guidelines.append(f"當前裝置電量狀態良好（{battery_level:.0f}%）。")

        # --- 處理心率邏輯（結合心律調節器判斷） ---
        if heart_rate is not None:
            if heart_rate >= 120:
                extra_guidelines.append(
                    f"⚠️ 當前心率過高（{heart_rate} BPM，恐慌預警）："
                    "請在 immediateActions 中加入一項（CRITICAL），指示進行「吸氣 4 秒、憋氣 4 秒、吐氣 4 秒」的呼吸調節法，尋找安全處坐下。"
                )
            elif 0 < heart_rate <= 50:
                # 結合醫療卡判斷
                if has_pacemaker:
                    extra_guidelines.append(
                        f"⚠️ 當前心率較低（{heart_rate} BPM），但使用者裝有「心律調節器」。"
                        "此心率極可能為設備設定值。請勿引起休克恐慌，請在 immediateActions 中提醒使用者：確認設備部位是否受到撞擊，並在逃生時遠離強磁場區域。"
                    )
                else:
                    extra_guidelines.append(
                        f"⚠️ 當前心率極低（{heart_rate} BPM，休克/失血/失溫預警）："
                        "請在 immediateActions 中加入一項最高優先級項（CRITICAL）："
                        "1. 強烈指示立即撥打 119 或 112 求救。\n"
                        "2. 詢問是否有嚴重出血，指示平躺、注意保暖。\n"
                        "3. 若無頭部或脊椎受傷疑慮，建議墊高雙腳（抗休克姿勢）。"
                    )
            else:
                extra_guidelines.append(f"當前心率數據正常（{heart_rate} BPM）。")

        status_prompt = "\n".join(extra_guidelines) if extra_guidelines else "無特殊設備/生理警示。"

        return f"""
你是一位災害應變專家 AI。請閱讀完整對話和感測器資料，以繁體中文回覆。
不得把推測當成使用者已確認的事實。一般災情問題直接回答；只有在使用者受困或
受傷時才提供完整救援步驟。若有立即生命危險，提醒撥打 119 或 112。

【極重要——輸出文字簡化與格式限制】：
1. 嚴禁複製或顯示任何 GPS 經緯度數字（例如 24.98934, 121.45080）。使用者在緊急狀況下不需要生硬的經緯度座標！
2. 狀況摘要 (situationSummary)：限制在 1~2 句極短中文（30 字以內），直接點出核心危險（例：「您被衣櫃壓傷且大量出血無法移動，請先保持冷靜並加壓止血。」）。
3. 立即處置 (immediateActions)：
   - 標題 (title)：請保持極簡短（4~8字，例：「撥打 119 或 112」、「加壓止血」、「保暖防休克」）。
   - 說明 (description)：限制在 1~2 句（30 字以內），只講最關鍵的自救動作，語氣直接、果斷。
4. 去除所有客套話與前言後語，極簡化文字以利緊急情況下的快速閱讀與節省手機電量。

{medical_context}
【當前即時生理與裝置狀況】
{status_prompt}

只回傳 JSON，不要 Markdown，格式如下：
{{
  "type": "災害類型",
  "riskLevel": 1,
  "situationSummary": "極簡短狀況摘要 (絕對禁止出現經緯度數字)",
  "immediateActions": [
    {{"title": "動作標題", "description": "極簡短具體安全動作/省電指示/平撫呼吸指示", "priority": "CRITICAL"}}
  ],
  "longTermAdvice": "後續簡短建議",
  "survivalProbability": 50,
  "missingInfoRequests": ["仍需確認的資訊"],
  "emergencySummary": {{
    "hasInjuries": false,
    "injurySummary": "",
    "injurySeverity": "unknown",
    "rescueNeeds": [],
    "isTrapped": false,
    "mobilityStatus": "unknown",
    "locationDetails": "",
    "urgencyLevel": 1,
    "confidence": 0
  }}
}}
priority 只能是 CRITICAL、HIGH、MEDIUM；injurySeverity 只能是 unknown、minor、
moderate、severe、critical；mobilityStatus 只能是 unknown、mobile、limited、immobile。
""".strip()


disaster_ai_service = DisasterAIService()