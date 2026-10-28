import json
import logging
import os
import re
from typing import Any, Dict, Optional

import httpx

from .gemini_http import post_gemini_with_retry

logger = logging.getLogger(__name__)

class LocationAIService:
    async def analyze_risk(
        self,
        location_info: str,
        disaster_info: str,
        verified_context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        api_key = os.getenv("GEMINI_API_KEY", "").strip()
        model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash").strip()
        
        if not api_key:
            raise ValueError("伺服器尚未設定 Gemini API Key")

        # GPS 經緯度不是地形資料。把規則引擎已確認的事實明確標示，
        # 防止模型以座標臆測海岸、山區或官方海嘯狀態。
        prompt = (
            f"使用者目前位置：{location_info}\n"
            f"當前即時災害情報：{disaster_info}\n"
            "已驗證、不可覆寫的應變資料："
            f"{json.dumps(verified_context or {}, ensure_ascii=False)}"
        )
        
        payload = {
            "systemInstruction": {"parts": [{"text": self._system_instruction()}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.2,
            },
        }
        
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        
        try:
            async with httpx.AsyncClient(timeout=25) as client:
                response = await post_gemini_with_retry(
                    client,
                    endpoint,
                    params={"key": api_key},
                    json_body=payload,
                    operation="Location analysis",
                )
                
                data = response.json()
                text = data.get("candidates", [])[0].get("content", {}).get("parts", [])[0].get("text", "")
                return self._parse_json(text)
                
        except Exception as e:
            logger.error("LBS AI 分析失敗: %s", e)
            # 發生錯誤時的預設防呆回傳
            return {
                "locationRiskLevel": "MEDIUM",
                "environmentalWarnings": ["無法取得精確環境分析，請隨時注意周遭變化。"],
                "questionsForUser": ["您目前的具體位置在哪裡？附近環境是否安全？"]
            }

    def _parse_json(self, text: str) -> Dict[str, Any]:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", text, re.DOTALL)
            if match:
                return json.loads(match.group(0))
            return {}

    def _system_instruction(self) -> str:
        return """
你是災害現場的「輔助說明」AI。生命安全判斷以輸入中的「已驗證、不可覆寫的應變資料」為最高優先，不能自行改寫或重新估算距離、規模、深度、影響級別或官方警報狀態。

【防止猜測的硬性規則】
1. GPS 經緯度本身不能證明所在地是海邊、山區、盆地或高樓區；除非 verified context 的 localEnvironment 明確提供，否則不得宣稱任何一種地形或建築特徵。
2. officialTsunamiStatus 為 unknown 時，必須寫「海嘯官方狀態尚未確認」，不得說「沒有海嘯警報」，也不得要求使用者僅憑此訊息撤離。
3. 不得提供預測震度、傷亡、建物倒塌機率或保證安全的說法。若資訊不足，請直接說需要依官方訊息與現場觀察確認。

【🚨 核心輸出原則：精簡 + 必須包含已驗證的影響判讀】
使用者正處於緊急逃生狀態，請提供條列式、極度精簡好讀的警告（每點控制在 20~25 字以內）。

【環境警告 (environmentalWarnings) 規範 - 請回傳 3~4 點】：
1. 【第一點 (強制必填)：震央距離與應變】
   - 必須忠實轉述 riskSummary 與 distanceKm，並給一項相符的具體應變措施。
   - 格式：「已確認距震央約 X 公里；[對應行動]。」

2. 【第二點起：環境與官方資訊】
   - localEnvironment 已驗證時，才可對應提醒（山區→落石、沿海→官方海嘯資訊、密集高樓→掉落物）。
   - localEnvironment 為 unknown 時，改提醒使用者觀察「外牆、掉落物、瓦斯、電線、邊坡」等眼前可確認的風險，不得杜撰所在地形。
   - officialTsunamiStatus 為 unknown 時，加入一點：「海嘯官方狀態尚未確認，沿海者請留意氣象署與地方政府訊息。」

3. 【待確認資訊 (questionsForUser)】：
   - 2~3 個極短的口語化確認問題（15 字以內）。

請務必回傳 JSON 格式。
""".strip()

location_ai_service = LocationAIService()
