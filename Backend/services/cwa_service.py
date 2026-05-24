import httpx
import logging
import os

logger = logging.getLogger(__name__)

class CWAService:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/E-A0015-001"
        # CWA's current TLS certificate chain can fail strict validation with
        # some Python/OpenSSL builds. Keep this configurable for production.
        self.verify_ssl = os.getenv("CWA_VERIFY_SSL", "false").lower() == "true"

    async def get_latest_alert(self):
        if not self.api_key:
            logger.error("CWA_API_KEY is not configured.")
            return {"error": "CWA API key 未設定"}

        try:
            async with httpx.AsyncClient(timeout=20, verify=self.verify_ssl) as client:
                params = {"Authorization": self.api_key}
                response = await client.get(self.base_url, params=params)
                response.raise_for_status()
                data = response.json()

                if str(data.get("success")).lower() != "true":
                    logger.error("CWA API returned unsuccessful response: %s", data)
                    return {"error": "CWA 回傳失敗"}

                earthquakes = data.get("records", {}).get("Earthquake", [])
                if not earthquakes:
                    return {"error": "目前沒有地震資料"}

                eq = earthquakes[0]["EarthquakeInfo"]
                return {
                    "magnitude": eq["EarthquakeMagnitude"]["MagnitudeValue"],
                    "location": eq["Epicenter"]["Location"],
                    "time": eq["OriginTime"],
                }
        except Exception as e:
            logger.exception("Unable to fetch CWA earthquake data: %s", e)
            return {"error": "無法取得即時資料"}
