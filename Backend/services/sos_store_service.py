"""
GuardiaAI SOS 多跳中繼 - 求救記錄的本機儲存

跟 offline_maps_service.py 用同一套模式：存在本機 JSON 檔案，不依賴
Firestore／Firebase 憑證。這是刻意的——收求救記錄的後端，本身也可能是
在災區自架、沒有雲端服務可用的機器，不該因為缺一組 Firebase 憑證就整條
路徑都動不了。

去重靠檔名（以 msg_id 命名），不需要另外做鎖定機制：同一個 msg_id 寫兩次
只是覆蓋同一個檔案，內容一樣，不會壞。
"""

import json
import logging
import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


class SosStoreService:
    def __init__(self) -> None:
        self.sos_reports_dir = Path("./data/sos_reports")
        self.sos_reports_dir.mkdir(parents=True, exist_ok=True)

    def _report_path(self, msg_id: str) -> Path:
        # msg_id 已由 sos_service.decode_header 驗證過是純可列印 ASCII，
        # 直接當檔名安全；仍加一層保險，避免路徑穿越字元混進來。
        safe_id = "".join(c for c in msg_id if c.isalnum())
        return self.sos_reports_dir / f"{safe_id}.json"

    def save_sos_report(
        self,
        msg_id: str,
        hops: int,
        urgency_level: int,
        is_trapped: bool,
        battery: Optional[int],
        location: Optional[Tuple[float, float]],
        location_details: str,
        from_local_id: str,
        payload: Dict[str, Any],
    ) -> bool:
        """
        記錄一則解密後的 SOS 求救內容。

        以 msg_id 為檔名天然去重：同一則求救被多個中繼者重複上傳時，
        直接覆蓋同一個檔案，回傳 False 告知呼叫端「這是重複的」。

        緊急度/是否受困/位置/位置描述/電量/發送者識別碼來自封包的明文標頭
        （中繼者也看得到）；真實姓名、傷勢摘要、救援需求、行動能力、醫療摘要
        來自解密後的 payload。
        """
        path = self._report_path(msg_id)
        is_new = not path.exists()

        medical = payload.get("medical") or {}
        record = {
            "msg_id": msg_id,
            "hops": hops,
            "urgency_level": urgency_level,
            "is_trapped": is_trapped,
            "battery_level": battery,
            "latitude": location[0] if location else None,
            "longitude": location[1] if location else None,
            "location_details": location_details,
            # 來自明文標頭，不是解密內容——v3 起識別碼放在標頭讓中繼者也看得到
            "from_local_id": from_local_id,
            "username": payload.get("username", "未知使用者"),
            "injury_summary": payload.get("injurySummary", ""),
            "rescue_needs": payload.get("rescueNeeds", []),
            "mobility_status": payload.get("mobilityStatus", "unknown"),
            "blood_type": medical.get("bloodType", ""),
            "drug_allergies": medical.get("drugAllergies", ""),
            "chronic_conditions": medical.get("chronicConditions", ""),
            "client_timestamp": payload.get("timestamp"),
            "received_at": self._now_iso(),
        }

        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(record, f, ensure_ascii=False, indent=2)
        except OSError as exc:
            logger.error("寫入求救記錄失敗 (%s): %s", msg_id, exc)
            raise

        return is_new

    def get_nearby_sos_reports(self, latitude: float, longitude: float, radius_km: float) -> List[Dict[str, Any]]:
        reports = []
        for path in self.sos_reports_dir.glob("*.json"):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    report = json.load(f)
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning("略過損毀的求救記錄檔 %s: %s", path, exc)
                continue

            lat, lon = report.get("latitude"), report.get("longitude")
            if lat is None or lon is None:
                continue
            distance = self._distance_km(latitude, longitude, float(lat), float(lon))
            if distance > radius_km:
                continue
            reports.append({**report, "distanceKm": round(distance, 2)})

        return sorted(reports, key=lambda item: (-item.get("urgency_level", 0), item["distanceKm"]))

    @staticmethod
    def _now_iso() -> str:
        from datetime import datetime, timezone
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        radius = 6371.0
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dlat, dlon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
        value = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
        return radius * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


# 全域實例
sos_store_service = SosStoreService()
