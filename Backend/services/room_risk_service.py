import base64
import json
import os
import re
from typing import Any, Dict, List

import httpx


class RoomRiskService:
    async def analyze_image(
        self,
        image_bytes: bytes,
        content_type: str,
        sensor_context: str = "",
    ) -> Dict[str, Any]:
        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("VITE_GEMINI_API_KEY")
        model = os.getenv("ROOM_RISK_MODEL", "gemini-3-flash-preview")
        endpoint = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent"
        )

        if not api_key:
            return self._fallback_analysis()

        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"text": self._prompt(sensor_context)},
                        {
                            "inlineData": {
                                "mimeType": content_type,
                                "data": base64.b64encode(image_bytes).decode("utf-8"),
                            }
                        },
                    ],
                }
            ],
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.2,
            },
        }

        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(
                endpoint,
                params={"key": api_key},
                json=payload,
            )
            response.raise_for_status()

        text = self._extract_text(response.json())
        data = self._parse_json(text)
        return self._normalize(data)

    def _prompt(self, sensor_context: str) -> str:
        return f"""
你是地震避難與室內安全檢查助手。請分析照片中的家具、櫃子、電器、玻璃、懸掛物、逃生通道、可躲避區域，以及可能形成保護空隙的地震三角區。

請只回傳 JSON，不要使用 Markdown。
座標請使用 0 到 1 的 normalized image coordinates，x 從左到右，y 從上到下。

重要安全原則：
1. 標準地震避難建議是 Drop, Cover, and Hold On，也就是趴下、掩護、穩住。
2. 若照片中有穩固桌子，優先標示桌下為 safe_floor 或 cover_safe_zone。
3. 地震三角區只能標示為 potential_triangle_void，表示「可能形成保護空隙」，不可宣稱絕對安全。
4. 不要把窗邊、高櫃旁、玻璃櫃旁、吊掛物下方標示為安全三角區。
5. 三角區只能畫在可見地板上，且必須遠離明顯傾倒、掉落、玻璃碎裂範圍。

回傳格式：
{{
  "summary": "一句中文摘要，例如：高櫃未固定、窗邊危險、桌下為相對安全區，沙發旁可能形成三角空隙。",
  "overallRiskLevel": 1,
  "objects": [
    {{
      "label": "高櫃",
      "risk": "high",
      "reason": "可能在地震時傾倒",
      "recommendation": "用 L 型固定片固定到牆面，重物下移",
      "bbox": {{ "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.5 }}
    }},
    {{
      "label": "沙發",
      "risk": "low",
      "reason": "高度較低且較不容易傾倒，旁邊可能形成保護空隙",
      "recommendation": "確認沙發旁沒有玻璃、櫃子或懸掛物威脅",
      "bbox": {{ "x": 0.35, "y": 0.55, "width": 0.35, "height": 0.25 }}
    }}
  ],
  "zones": [
    {{
      "id": "topple-tall-cabinet",
      "type": "danger",
      "impactType": "topple",
      "label": "高櫃傾倒範圍",
      "reason": "高櫃可能朝前方地面傾倒",
      "sourceObjectLabel": "高櫃",
      "polygon": [
        {{ "x": 0.1, "y": 0.62 }},
        {{ "x": 0.3, "y": 0.62 }},
        {{ "x": 0.52, "y": 0.94 }},
        {{ "x": 0.04, "y": 0.94 }}
      ]
    }},
    {{
      "id": "triangle-void-sofa-side",
      "type": "potential_safe",
      "impactType": "triangle_void",
      "label": "可能三角避難空隙",
      "reason": "低矮且相對穩固的沙發旁，可能在掉落物或局部變形時形成保護空隙，但僅作為輔助參考",
      "sourceObjectLabel": "沙發",
      "polygon": [
        {{ "x": 0.28, "y": 0.70 }},
        {{ "x": 0.36, "y": 0.68 }},
        {{ "x": 0.42, "y": 0.92 }},
        {{ "x": 0.20, "y": 0.94 }}
      ]
    }}
  ]
}}

判斷重點：
1. 可能倒塌、滑動、墜落、碎裂的家具或物件。
2. 逃生動線是否被家具、雜物或門口障礙阻擋。
3. 地震時不建議停留的位置，例如窗邊、高櫃旁、吊燈下。
4. 相對安全區域，例如穩固桌下、遠離窗戶與高櫃的位置。
5. 可能形成三角空隙的區域，例如低矮且穩固的沙發、床、矮櫃旁邊，但必須避開玻璃、高櫃與掉落物。
6. 每個風險都要給出具體改善建議。

地面區域繪製規則，必須嚴格遵守：
1. 每個 danger 或 caution 區域必須對應至少一個 sourceObjectLabel，表示該區域是由哪個家具或物件造成的風險。
2. 每個 high 或 medium 風險家具至少建立一個對應 danger zone。
3. 家具傾倒區必須從家具底部接觸地面的左右兩側開始，朝可能傾倒方向延伸到地板，長度約等於家具可見高度。
4. 掉落物區域要畫在物件正下方地板，並稍微向外擴張。
5. 玻璃區域要沿窗戶或玻璃櫃下方地板向外延伸，表示碎片散落範圍。
6. blocked_path 只畫在被阻塞的地面逃生動線。
7. safe_floor 只能畫在無家具傾倒、玻璃、掉落物威脅的地板。
8. triangle_void 只能畫在低矮、厚重、相對穩固物件旁邊的地板區域，例如沙發、床、矮櫃、堅固桌子旁。
9. triangle_void 不可與 topple、falling、glass、blocked_path 區域重疊。
10. triangle_void 的 polygon 應該貼近 sourceObjectLabel 的側邊地板，形成狹長或梯形區域，不要畫到物件本體上。
11. polygon 請沿著照片透視形成梯形或四邊形，靠近鏡頭的一側通常較寬。
12. impactType 只能是 topple、falling、glass、blocked_path、safe_floor、triangle_void。
13. sourceObjectLabel 要對應 objects 中的家具名稱；safe_floor 可以省略。

即時感測器背景資訊：{sensor_context or "無"}
"""

    def _extract_text(self, response: Dict[str, Any]) -> str:
        candidates = response.get("candidates") or []
        if not candidates:
            raise ValueError("AI 沒有回傳可用分析。")

        parts = candidates[0].get("content", {}).get("parts", [])
        texts = [part.get("text", "") for part in parts if part.get("text")]
        if not texts:
            raise ValueError("AI 回應缺少文字內容。")
        return "\n".join(texts)

    def _parse_json(self, text: str) -> Dict[str, Any]:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", text, re.DOTALL)
            if not match:
                raise ValueError("AI 回應不是有效 JSON。")
            return json.loads(match.group(0))

    def _normalize(self, data: Dict[str, Any]) -> Dict[str, Any]:
        objects = [self._normalize_object(item) for item in data.get("objects", [])]
        zones = [self._normalize_zone(item, index) for index, item in enumerate(data.get("zones", []))]
        zones = [zone for zone in zones if len(zone["polygon"]) >= 3]

        return {
            "summary": str(data.get("summary") or "已完成室內地震家具風險分析。"),
            "overallRiskLevel": max(1, min(5, int(data.get("overallRiskLevel") or 3))),
            "objects": objects[:8],
            "zones": zones[:8],
        }

    def _normalize_object(self, item: Dict[str, Any]) -> Dict[str, Any]:
        bbox = item.get("bbox") or {}
        risk = item.get("risk") if item.get("risk") in {"high", "medium", "low"} else "medium"
        return {
            "label": str(item.get("label") or "未命名物件"),
            "risk": risk,
            "reason": str(item.get("reason") or "需要人工確認此物件在地震時是否會移動或倒塌。"),
            "recommendation": str(item.get("recommendation") or "確認是否固定，並移除高處重物。"),
            "bbox": {
                "x": self._clamp(bbox.get("x", 0.1)),
                "y": self._clamp(bbox.get("y", 0.1)),
                "width": self._clamp(bbox.get("width", 0.25)),
                "height": self._clamp(bbox.get("height", 0.25)),
            },
        }

    def _normalize_zone(self, item: Dict[str, Any], index: int) -> Dict[str, Any]:
        raw_zone_type = item.get("type")
        # The model uses potential_safe for triangle voids. Expose it as the
        # existing safe UI category, while preserving triangle_void below.
        zone_type = "safe" if raw_zone_type == "potential_safe" else raw_zone_type
        if zone_type not in {"danger", "caution", "safe"}:
            zone_type = "caution"
        impact_types = {
            "topple", "falling", "glass", "blocked_path", "safe_floor", "triangle_void"
        }
        impact_type = item.get("impactType")
        if impact_type not in impact_types:
            impact_type = "safe_floor" if zone_type == "safe" else "topple"
        polygon = item.get("polygon") or []
        points = [
            {"x": self._clamp(point.get("x", 0)), "y": self._clamp(point.get("y", 0))}
            for point in polygon
            if isinstance(point, dict)
        ]
        # Do not invent a full-image polygon. Invalid zones are removed by
        # _normalize so AR never displays a fabricated floor region.

        return {
            "id": str(item.get("id") or f"zone-{index + 1}"),
            "type": zone_type,
            "impactType": impact_type,
            "label": str(item.get("label") or "注意區域"),
            "reason": str(item.get("reason") or "此區域需要進一步人工確認。"),
            "sourceObjectLabel": str(item.get("sourceObjectLabel") or "") or None,
            "polygon": points,
        }

    def _clamp(self, value: Any) -> float:
        try:
            number = float(value)
        except (TypeError, ValueError):
            number = 0
        return max(0.0, min(1.0, number))

    def _fallback_analysis(self) -> Dict[str, Any]:
        return {
            "summary": "目前未設定 Gemini API key，已使用展示用規則：高櫃與窗邊列為危險區，房間中央低矮家具旁列為相對安全區。",
            "overallRiskLevel": 3,
            "objects": [
                {
                    "label": "高櫃/大型家具",
                    "risk": "high",
                    "reason": "若未固定，地震時可能傾倒或阻擋逃生動線。",
                    "recommendation": "用 L 型固定片固定到牆面，並把重物移到低處。",
                    "bbox": {"x": 0.08, "y": 0.14, "width": 0.26, "height": 0.62},
                },
                {
                    "label": "窗邊或玻璃區",
                    "risk": "medium",
                    "reason": "強震時玻璃碎裂與窗邊物品掉落風險較高。",
                    "recommendation": "避難時遠離窗邊，並移除窗台上方重物。",
                    "bbox": {"x": 0.62, "y": 0.12, "width": 0.28, "height": 0.42},
                },
            ],
            "zones": [
                {
                    "id": "danger-tall-furniture",
                    "type": "danger",
                    "impactType": "topple",
                    "label": "高櫃傾倒危險區",
                    "reason": "大型家具倒塌半徑內不適合停留。",
                    "sourceObjectLabel": "高櫃/大型家具",
                    "polygon": [
                        {"x": 0.08, "y": 0.7},
                        {"x": 0.34, "y": 0.7},
                        {"x": 0.5, "y": 0.96},
                        {"x": 0.02, "y": 0.96},
                    ],
                },
                {
                    "id": "caution-window",
                    "type": "caution",
                    "impactType": "glass",
                    "label": "窗邊注意區",
                    "reason": "玻璃與懸掛物可能碎裂或掉落。",
                    "sourceObjectLabel": "窗邊或玻璃區",
                    "polygon": [
                        {"x": 0.62, "y": 0.58},
                        {"x": 0.9, "y": 0.58},
                        {"x": 0.98, "y": 0.88},
                        {"x": 0.54, "y": 0.88},
                    ],
                },
                {
                    "id": "safe-center-low",
                    "type": "safe",
                    "impactType": "safe_floor",
                    "label": "相對安全區",
                    "reason": "遠離高櫃與窗邊，可作為暫時低姿勢避難點。",
                    "polygon": [
                        {"x": 0.42, "y": 0.62},
                        {"x": 0.74, "y": 0.62},
                        {"x": 0.74, "y": 0.9},
                        {"x": 0.42, "y": 0.9},
                    ],
                },
            ],
        }


room_risk_service = RoomRiskService()
