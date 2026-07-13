import logging
import os

import httpx

logger = logging.getLogger(__name__)


class CWAService:
    def __init__(self, api_key: str | None):
        self.api_key = api_key or ""
        self.base = "https://opendata.cwa.gov.tw/api/v1/rest/datastore"
        self.legacy_url = f"{self.base}/E-A0015-001"
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
                response = await client.get(self.legacy_url, params=params)
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

    async def get_earthquake_list(self):
        """回傳近期地震列表，合併小區域 + 顯著有感兩支 API 並去重排序。"""
        if not self.api_key:
            return []

        endpoints = [
            f"{self.base}/E-A0015-001",  # 顯著有感地震
            f"{self.base}/E-A0016-001",  # 小區域有感地震
        ]
        params = {"Authorization": self.api_key, "limit": 5, "format": "JSON"}

        collected = []
        async with httpx.AsyncClient(timeout=20, verify=self.verify_ssl) as client:
            for url in endpoints:
                try:
                    response = await client.get(url, params=params)
                    response.raise_for_status()
                    body = response.json()
                    for eq in body.get("records", {}).get("Earthquake") or []:
                        info = eq.get("EarthquakeInfo") or {}
                        epicenter = info.get("Epicenter") or {}
                        magnitude = info.get("EarthquakeMagnitude") or {}
                        collected.append(
                            {
                                "id": eq.get("EarthquakeNo"),
                                "originTime": info.get("OriginTime") or "",
                                "location": epicenter.get("Location") or "未知地點",
                                "magnitude": magnitude.get("MagnitudeValue") or 0,
                                "depth": info.get("FocalDepth") or 0,
                                "epicenterLat": epicenter.get("EpicenterLatitude"),
                                "epicenterLng": epicenter.get("EpicenterLongitude"),
                                "reportColor": eq.get("ReportColor") or "",
                                "web": eq.get("Web") or "",
                            }
                        )
                except Exception as e:
                    logger.warning("Unable to fetch CWA list endpoint %s: %s", url, e)
                    continue

        seen = set()
        unique = []
        for earthquake in collected:
            earthquake_id = earthquake["id"]
            if earthquake_id is None or earthquake_id in seen:
                continue
            seen.add(earthquake_id)
            unique.append(earthquake)

        unique.sort(key=lambda item: item["originTime"], reverse=True)
        return unique
