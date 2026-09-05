import json
import logging
import os
import re
from typing import Any, Dict

import httpx

logger = logging.getLogger(__name__)

class LocationAIService:
    async def analyze_risk(self, location_info: str, disaster_info: str) -> Dict[str, Any]:
        api_key = os.getenv("GEMINI_API_KEY", "").strip()
        model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash").strip()
        
        if not api_key:
            raise ValueError("伺服器尚未設定 Gemini API Key")

        # 把前端傳來的定位與氣象署災情組合起來
        prompt = f"使用者目前位置：{location_info}\n當前即時災害情報：{disaster_info}"
        
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
                response = await client.post(endpoint, params={"key": api_key}, json=payload)
                response.raise_for_status()
                
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
你是一個專業的地理、地形與環境災變分析 AI 專家。
請根據傳入的「使用者 GPS 座標」與「災害情報（含震央位置/座標與規模）」，進行精準的在地化風險評估。

【🚨 核心輸出原則：精簡 + 必須包含震央距離應變】
使用者正處於緊急逃生狀態，請提供條列式、極度精簡好讀的警告（每點控制在 20~25 字以內）。

【環境警告 (environmentalWarnings) 規範 - 請回傳 3~4 點】：
1. 【第一點 (強制必填)：震央距離與應變】
   - 必須先評估使用者與震央的距離。
   - 格式：「因為處於 [震央極震區 / 近震央區 / 中遠距離]，[具體應變措施或搖晃衝擊預警]。」
   - 範例：「因為處於震央極震區，請立即執行趴下掩護，防範劇烈搖晃。」或「因為距離震央較遠，搖晃緩和但仍須注意強烈餘震。」

2. 【第二點起：在地地形與環境特徵風險】
   - 結合當地的地理/地形/建築特徵（如：盆地共振、山區落石、海岸海嘯、高樓密集掉落物）。
   - 格式：「因為 [當地地形/環境特徵]，請防範 [特定風險]。」
   - 範例：「因為位處盆地地形，請防範長週期共振引發的持續搖晃。」

3. 【待確認資訊 (questionsForUser)】：
   - 2~3 個極短的口語化確認問題（15 字以內）。

請務必回傳 JSON 格式。
""".strip()

location_ai_service = LocationAIService()