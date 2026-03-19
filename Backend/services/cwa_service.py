import httpx
from datetime import datetime

class CWAService:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/E-A0015-001"

    async def get_latest_alert(self):
        try:
            async with httpx.AsyncClient() as client:
                params = {"Authorization": self.api_key}
                response = await client.get(self.base_url, params=params)
                data = response.json()
                # 簡化回傳，讓前端 Gemini 好讀取
                eq = data['records']['Earthquake'][0]['EarthquakeInfo']
                return {
                    "magnitude": eq['EarthquakeMagnitude']['MagnitudeValue'],
                    "location": eq['Epicenter']['Location'],
                    "time": eq['OriginTime']
                }
        except Exception as e:
            return {"error": "無法取得即時資料"}