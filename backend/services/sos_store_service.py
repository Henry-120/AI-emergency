"""Persist decrypted SOS relay reports in the existing Firestore backend."""

from datetime import datetime, timezone
import math
from typing import Any, Dict, List, Optional, Tuple

from services.firebase_service import firebase_service


class SosStoreService:
    """Cloud Run-safe SOS storage backed by the ``sos_reports`` collection."""

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
        db = firebase_service._get_db()
        ref = db.collection("sos_reports").document(msg_id)
        is_new = not ref.get().exists
        medical = payload.get("medical") or {}
        ref.set(
            {
                "msg_id": msg_id,
                "hops": hops,
                "urgency_level": urgency_level,
                "is_trapped": is_trapped,
                "battery_level": battery,
                "latitude": location[0] if location else None,
                "longitude": location[1] if location else None,
                "location_details": location_details,
                "from_local_id": from_local_id,
                "username": payload.get("username", "未知使用者"),
                "injury_summary": payload.get("injurySummary", ""),
                "rescue_needs": payload.get("rescueNeeds", []),
                "mobility_status": payload.get("mobilityStatus", "unknown"),
                "blood_type": medical.get("bloodType", ""),
                "drug_allergies": medical.get("drugAllergies", ""),
                "chronic_conditions": medical.get("chronicConditions", ""),
                "client_timestamp": payload.get("timestamp"),
                "received_at": datetime.now(timezone.utc),
            },
            merge=True,
        )
        return is_new

    def get_nearby_sos_reports(
        self, latitude: float, longitude: float, radius_km: float
    ) -> List[Dict[str, Any]]:
        reports: List[Dict[str, Any]] = []
        collection = firebase_service._get_db().collection("sos_reports")
        for snapshot in collection.stream():
            report = snapshot.to_dict()
            lat, lon = report.get("latitude"), report.get("longitude")
            if lat is None or lon is None:
                continue
            distance = self._distance_km(latitude, longitude, float(lat), float(lon))
            if distance <= radius_km:
                reports.append({**report, "distanceKm": round(distance, 2)})
        return sorted(
            reports,
            key=lambda item: (-item.get("urgency_level", 0), item["distanceKm"]),
        )

    @staticmethod
    def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        radius = 6371.0
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dlat, dlon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
        value = (
            math.sin(dlat / 2) ** 2
            + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
        )
        return radius * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


sos_store_service = SosStoreService()
