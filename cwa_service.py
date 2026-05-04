import httpx

class CWAService:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base = "https://opendata.cwa.gov.tw/api/v1/rest/datastore"
        self.legacy_url = f"{self.base}/E-A0015-001"

    async def get_latest_alert(self):
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                params = {"Authorization": self.api_key}
                response = await client.get(self.legacy_url, params=params)
                data = response.json()
                eq = data['records']['Earthquake'][0]['EarthquakeInfo']
                return {
                    "magnitude": eq['EarthquakeMagnitude']['MagnitudeValue'],
                    "location": eq['Epicenter']['Location'],
                    "time": eq['OriginTime']
                }
        except Exception:
            return {"error": "無法取得即時資料"}

    async def get_earthquake_list(self):
        """回傳近期地震列表，合併小區域 + 顯著有感兩支 API 並去重排序"""
        if not self.api_key:
            return []

        endpoints = [
            f"{self.base}/E-A0015-001",  # 顯著有感地震
            f"{self.base}/E-A0016-001",  # 小區域有感地震
        ]
        params = {"Authorization": self.api_key, "limit": 5, "format": "JSON"}

        collected = []
        async with httpx.AsyncClient(timeout=10) as client:
            for url in endpoints:
                try:
                    r = await client.get(url, params=params)
                    body = r.json()
                    for eq in (body.get("records", {}).get("Earthquake") or []):
                        info = eq.get("EarthquakeInfo") or {}
                        epicenter = info.get("Epicenter") or {}
                        magnitude = info.get("EarthquakeMagnitude") or {}
                        collected.append({
                            "id": eq.get("EarthquakeNo"),
                            "originTime": info.get("OriginTime") or "",
                            "location": epicenter.get("Location") or "未知地點",
                            "magnitude": magnitude.get("MagnitudeValue") or 0,
                            "depth": info.get("FocalDepth") or 0,
                            "epicenterLat": epicenter.get("EpicenterLatitude"),
                            "epicenterLng": epicenter.get("EpicenterLongitude"),
                            "reportColor": eq.get("ReportColor") or "",
                            "web": eq.get("Web") or "",
                        })
                except Exception:
                    continue

        seen = set()
        unique = []
        for e in collected:
            if e["id"] is None or e["id"] in seen:
                continue
            seen.add(e["id"])
            unique.append(e)

        unique.sort(key=lambda x: x["originTime"], reverse=True)
        return unique