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
                epicenter = eq["Epicenter"]
                return {
                    "magnitude": eq["EarthquakeMagnitude"]["MagnitudeValue"],
                    "location": epicenter["Location"],
                    "time": eq["OriginTime"],
                    "depth": eq.get("FocalDepth"),
                    "epicenterLat": epicenter.get("EpicenterLatitude"),
                    "epicenterLng": epicenter.get("EpicenterLongitude"),
                }
        except Exception as e:
            logger.exception("Unable to fetch CWA earthquake data: %s", e)
            return {"error": "無法取得即時資料"}

    async def get_current_weather_observation(self, station_id: str = "466920"):
        """取得指定測站的「現在天氣觀測報告」(O-A0001-001)。

        這支資料每 10 分鐘更新一次，遠比地震資料頻繁，僅用於測試推播路徑，
        不用於正式的災害警示邏輯。station_id 預設為台北測站。
        """
        if not self.api_key:
            return {"error": "CWA API key 未設定"}

        url = f"{self.base}/O-A0001-001"
        try:
            async with httpx.AsyncClient(timeout=20, verify=self.verify_ssl) as client:
                params = {"Authorization": self.api_key, "StationId": station_id}
                response = await client.get(url, params=params)
                response.raise_for_status()
                data = response.json()

                if str(data.get("success")).lower() != "true":
                    logger.error("CWA weather observation API returned unsuccessful response: %s", data)
                    return {"error": "CWA 回傳失敗"}

                stations = data.get("records", {}).get("Station") or []
                if not stations:
                    return {"error": "查無測站資料"}

                station = stations[0]
                weather = station.get("WeatherElement") or {}
                return {
                    "stationId": station.get("StationId"),
                    "stationName": station.get("StationName"),
                    "obsTime": (station.get("ObsTime") or {}).get("DateTime"),
                    "temperature": weather.get("AirTemperature"),
                }
        except Exception as e:
            logger.exception("Unable to fetch CWA weather observation: %s", e)
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
