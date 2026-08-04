import csv
import io
import json
import logging
import math
import os
import time
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import quote

import requests

logger = logging.getLogger(__name__)


TAIWAN_CITIES = [
    "基隆市",
    "臺北市",
    "新北市",
    "桃園市",
    "新竹市",
    "新竹縣",
    "苗栗縣",
    "臺中市",
    "彰化縣",
    "南投縣",
    "雲林縣",
    "嘉義市",
    "嘉義縣",
    "臺南市",
    "高雄市",
    "屏東縣",
    "宜蘭縣",
    "花蓮縣",
    "臺東縣",
    "澎湖縣",
    "金門縣",
    "連江縣",
]


class ShelterService:
    def __init__(self) -> None:
        self.cache_dir = Path("./data/shelters")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.cache_file = self.cache_dir / "taiwan_shelters.json"
        self.official_json_file = self.cache_dir / "taiwan_shelters.json"
        self.seed_file = self.cache_dir / "seed_shelters.json"
        self.cache_ttl_seconds = int(os.getenv("SHELTER_CACHE_TTL_SECONDS", "86400"))
        self.base_url = os.getenv(
            "SHELTER_API_BASE_URL",
            "https://portal.emic.gov.tw/EEAWeb/api/v1/shelter/city",
        )
        self.enable_city_api = os.getenv("SHELTER_ENABLE_CITY_API", "false").lower() == "true"
        self.prefer_remote = os.getenv("SHELTER_PREFER_REMOTE", "false").lower() == "true"
        self.csv_urls = [
            url.strip()
            for url in os.getenv(
                "SHELTER_CSV_URLS",
                "https://scidm.nchc.org.tw/dataset/best_wish73242/resource/8f35f192-184d-4bd8-9fbf-c73670def8fb/nchcproxy",
            ).split(",")
            if url.strip()
        ]

    def get_nearby_shelters(
        self, latitude: float, longitude: float, radius_km: float = 10
    ) -> Dict[str, Any]:
        shelters = self._load_or_fetch_shelters()
        if not shelters:
            return {
                "success": False,
                "error": "目前無法取得避難所資料，且本機沒有可用快取。",
                "center": {"lat": latitude, "lon": longitude},
                "radius_km": radius_km,
                "shelters": [],
                "count": 0,
                "source": "內政部消防署 避難收容處所查詢",
                "cached_at": None,
            }

        nearby = []

        for shelter in shelters:
            shelter_lat = shelter.get("lat")
            shelter_lon = shelter.get("lon")
            if shelter_lat is None or shelter_lon is None:
                continue

            distance = self._distance_km(latitude, longitude, shelter_lat, shelter_lon)
            if distance <= radius_km:
                nearby.append(
                    {
                        **shelter,
                        "distance_km": round(distance, 3),
                        "bearing_deg": round(
                            self._bearing(latitude, longitude, shelter_lat, shelter_lon),
                            1,
                        ),
                    }
                )

        nearby.sort(key=lambda item: item["distance_km"])
        return {
            "success": True,
            "center": {"lat": latitude, "lon": longitude},
            "radius_km": radius_km,
            "shelters": nearby[:100],
            "count": len(nearby[:100]),
            "source": "內政部消防署 避難收容處所查詢",
            "cached_at": self._cache_mtime(),
        }

    def refresh_cache(self) -> Dict[str, Any]:
        shelters = self._fetch_all_shelters()
        self._save_cache(shelters)
        return {"success": True, "count": len(shelters), "cached_at": self._cache_mtime()}

    def _load_or_fetch_shelters(self) -> List[Dict[str, Any]]:
        if self.cache_file.exists():
            age = time.time() - self.cache_file.stat().st_mtime
            if age < self.cache_ttl_seconds:
                return self._read_cache()

        official_shelters = self._read_official_json()
        if official_shelters:
            return official_shelters

        if not self.prefer_remote:
            seed_shelters = self._read_seed()
            if seed_shelters:
                return seed_shelters

        shelters = self._fetch_all_shelters()
        if shelters:
            self._save_cache(shelters)
            return shelters

        seed_shelters = self._read_seed()
        if seed_shelters:
            return seed_shelters

        return self._read_cache()

    def _read_cache(self) -> List[Dict[str, Any]]:
        if not self.cache_file.exists():
            return []

        with self.cache_file.open(encoding="utf-8") as file:
            data = json.load(file)
        return data.get("shelters", [])

    def _read_official_json(self) -> List[Dict[str, Any]]:
        if not self.official_json_file.exists():
            return []

        with self.official_json_file.open(encoding="utf-8") as file:
            data = json.load(file)
        return data.get("shelters", [])

    def _read_seed(self) -> List[Dict[str, Any]]:
        if not self.seed_file.exists():
            return []

        with self.seed_file.open(encoding="utf-8") as file:
            data = json.load(file)
        return data.get("shelters", [])

    def _save_cache(self, shelters: List[Dict[str, Any]]) -> None:
        payload = {
            "cached_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "shelters": shelters,
        }
        with self.cache_file.open("w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False, indent=2)

    def _cache_mtime(self) -> str | None:
        if not self.cache_file.exists():
            return None
        return time.strftime(
            "%Y-%m-%dT%H:%M:%S%z", time.localtime(self.cache_file.stat().st_mtime)
        )

    def _fetch_all_shelters(self) -> List[Dict[str, Any]]:
        csv_shelters = self._fetch_csv_shelters()
        if csv_shelters:
            return csv_shelters

        if not self.enable_city_api:
            return []

        shelters: Dict[str, Dict[str, Any]] = {}

        for city in TAIWAN_CITIES:
            url = f"{self.base_url}/{quote(city)}"
            try:
                response = requests.get(url, timeout=20)
                response.raise_for_status()
                for shelter in self._extract_shelters(response.json()):
                    normalized = self._normalize_shelter(shelter)
                    if not normalized:
                        continue
                    shelters[normalized["id"]] = normalized
            except Exception as exc:
                logger.warning("避難所資料下載失敗 %s: %s", city, exc)

        return list(shelters.values())

    def _fetch_csv_shelters(self) -> List[Dict[str, Any]]:
        shelters: Dict[str, Dict[str, Any]] = {}

        for url in self.csv_urls:
            try:
                response = requests.get(url, timeout=25)
                response.raise_for_status()
                response.encoding = response.encoding or "utf-8-sig"
                rows = csv.DictReader(io.StringIO(response.text))

                for row in rows:
                    normalized = self._normalize_shelter(row)
                    if normalized:
                        shelters[normalized["id"]] = normalized
            except Exception as exc:
                logger.warning("避難所 CSV 下載失敗 %s: %s", url, exc)

        return list(shelters.values())

    def _extract_shelters(self, data: Any) -> List[Dict[str, Any]]:
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]

        if not isinstance(data, dict):
            return []

        candidates = []
        for key in ["shelterList", "shelters", "items", "data", "result"]:
            value = data.get(key)
            if isinstance(value, list):
                candidates.extend([item for item in value if isinstance(item, dict)])
            elif isinstance(value, dict):
                candidates.extend(self._extract_shelters(value))

        return candidates

    def _normalize_shelter(self, raw: Dict[str, Any]) -> Dict[str, Any] | None:
        lat = self._to_float(raw.get("lat") or raw.get("latitude") or raw.get("緯度"))
        lon = self._to_float(raw.get("lon") or raw.get("lng") or raw.get("longitude") or raw.get("經度"))
        if lat is None or lon is None:
            return None

        shelter_id = str(raw.get("shelterID") or raw.get("id") or raw.get("處所編號") or "")
        name = str(
            raw.get("shelterName")
            or raw.get("name")
            or raw.get("處所名稱")
            or raw.get("避難收容處所名稱")
            or "未命名避難所"
        )
        if not shelter_id:
            shelter_id = f"{name}-{lat:.6f}-{lon:.6f}"

        city_town = raw.get("縣市及鄉鎮市區") or ""

        return {
            "id": shelter_id,
            "name": name,
            "city": raw.get("cityName") or raw.get("city") or raw.get("縣市") or city_town[:3],
            "town": raw.get("townName") or raw.get("town") or raw.get("鄉鎮市區") or city_town[3:],
            "village": raw.get("villageName") or raw.get("village") or raw.get("村里"),
            "address": raw.get("address") or raw.get("地址") or raw.get("避難收容處所地址") or "",
            "lat": lat,
            "lon": lon,
            "open_status": raw.get("openStatus") or raw.get("openstatus") or raw.get("開設狀態") or "",
            "disaster_type": raw.get("disasterType") or raw.get("適用災害類別") or "",
            "capacity": self._to_int(raw.get("acceptPopulation") or raw.get("收容人數") or raw.get("預計收容人數")),
            "contact_name": raw.get("contactName") or raw.get("聯絡人") or raw.get("管理人姓名") or "",
            "contact_phone": raw.get("contactPhone") or raw.get("聯絡電話") or raw.get("管理人電話") or "",
            "last_update_time": raw.get("lastUpdateTime") or raw.get("資料更新時間") or "",
        }

    def _to_float(self, value: Any) -> float | None:
        try:
            if value in (None, ""):
                return None
            return float(value)
        except (TypeError, ValueError):
            return None

    def _to_int(self, value: Any) -> int | None:
        try:
            if value in (None, ""):
                return None
            return int(float(value))
        except (TypeError, ValueError):
            return None

    def _distance_km(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        radius = 6371
        d_lat = math.radians(lat2 - lat1)
        d_lon = math.radians(lon2 - lon1)
        a = (
            math.sin(d_lat / 2) ** 2
            + math.cos(math.radians(lat1))
            * math.cos(math.radians(lat2))
            * math.sin(d_lon / 2) ** 2
        )
        return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    def _bearing(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        d_lon = math.radians(lon2 - lon1)
        y = math.sin(d_lon) * math.cos(math.radians(lat2))
        x = math.cos(math.radians(lat1)) * math.sin(math.radians(lat2)) - math.sin(
            math.radians(lat1)
        ) * math.cos(math.radians(lat2)) * math.cos(d_lon)
        return (math.degrees(math.atan2(y, x)) + 360) % 360


shelter_service = ShelterService()
