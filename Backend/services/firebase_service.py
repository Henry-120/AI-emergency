import hashlib
import json
import os
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from uuid import uuid4

import schemas


class FirebaseService:
    """Firestore repository used by every persistent backend API."""

    def __init__(self) -> None:
        self._db = None

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)

    @staticmethod
    def _index_id(value: str) -> str:
        return hashlib.sha256(value.strip().lower().encode("utf-8")).hexdigest()

    def create_user(self, username: str, email: str | None, password_hash: str) -> dict:
        db = self._get_db()
        normalized_username = username.strip().lower()
        normalized_email = email.strip().lower() if email else None
        username_ref = db.collection("auth_usernames").document(self._index_id(normalized_username))
        email_ref = (
            db.collection("auth_emails").document(self._index_id(normalized_email))
            if normalized_email else None
        )
        user_id = uuid4().hex
        user_ref = db.collection("users").document(user_id)
        now = self._now()

        from firebase_admin import firestore

        @firestore.transactional
        def create(transaction):
            if username_ref.get(transaction=transaction).exists:
                raise ValueError("username_exists")
            if email_ref and email_ref.get(transaction=transaction).exists:
                raise ValueError("email_exists")
            user = {
                "id": user_id,
                "username": username,
                "username_normalized": normalized_username,
                "email": email,
                "password_hash": password_hash,
                "created_at": now,
            }
            transaction.set(user_ref, user)
            transaction.set(username_ref, {"user_id": user_id})
            if email_ref:
                transaction.set(email_ref, {"user_id": user_id})
            return user

        user = create(db.transaction())
        db.collection("medical_cards").document(user_id).set({
            "user_id": user_id,
            "full_name": username,
            "updated_at": now,
        })
        return user

    def get_user(self, user_id: str) -> dict | None:
        snapshot = self._get_db().collection("users").document(str(user_id)).get()
        return snapshot.to_dict() if snapshot.exists else None

    def get_user_by_username(self, username: str) -> dict | None:
        db = self._get_db()
        index = db.collection("auth_usernames").document(self._index_id(username)).get()
        if not index.exists:
            return None
        return self.get_user(index.to_dict()["user_id"])

    def get_medical_card(self, user: dict) -> dict:
        ref = self._get_db().collection("medical_cards").document(user["id"])
        snapshot = ref.get()
        if snapshot.exists:
            return snapshot.to_dict()
        card = {"user_id": user["id"], "full_name": user["username"], "updated_at": self._now()}
        ref.set(card)
        return card

    def update_medical_card(self, user_id: str, card: schemas.MedicalCardBase) -> dict:
        payload = card.model_dump()
        payload.update({"user_id": user_id, "updated_at": self._now()})
        self._get_db().collection("medical_cards").document(user_id).set(payload, merge=True)
        return payload

    def upsert_emergency_report(
        self, user_id: str, data: schemas.EmergencyReportUpsert
    ) -> dict:
        db = self._get_db()
        summary = data.summary.model_dump()
        summary["urgencyLevel"] = max(1, min(10, summary["urgencyLevel"]))
        summary["confidence"] = max(0, min(1, summary["confidence"]))
        now = self._now()
        requires_rescue = (
            summary["isTrapped"]
            or bool(summary["rescueNeeds"])
            or summary["injurySeverity"] in {"severe", "critical"}
            or summary["urgencyLevel"] >= 7
        )
        payload = {
            **summary,
            "userId": user_id,
            "latitude": data.latitude,
            "longitude": data.longitude,
            "requiresRescue": requires_rescue,
            "updatedAt": now,
        }
        report_ref = db.collection("emergency_reports").document(user_id)
        report_ref.set(payload)

        # Messages live in a subcollection so the report cannot exceed Firestore's
        # single-document size limit. Rebuild it because the client sends a snapshot.
        messages = report_ref.collection("chat_history")
        for page in self._chunks(list(messages.stream()), 450):
            batch = db.batch()
            for snapshot in page:
                batch.delete(snapshot.reference)
            batch.commit()
        for page in self._chunks(data.messages, 450):
            batch = db.batch()
            for message in page:
                ref = messages.document()
                batch.set(ref, {
                    "role": message.role,
                    "content": message.content,
                    "timestamp": message.timestamp or now,
                })
            batch.commit()
        return payload

    def get_emergency_report(self, user_id: str) -> dict | None:
        snapshot = self._get_db().collection("emergency_reports").document(user_id).get()
        return snapshot.to_dict() if snapshot.exists else None

    def get_nearby_rescue_cases(self, latitude: float, longitude: float, radius_km: float) -> list[dict]:
        db = self._get_db()
        cases = []
        for snapshot in db.collection("emergency_reports").where("requiresRescue", "==", True).stream():
            report = snapshot.to_dict()
            lat, lon = report.get("latitude"), report.get("longitude")
            if lat is None or lon is None:
                continue
            distance = self._distance_km(latitude, longitude, float(lat), float(lon))
            if distance > radius_km:
                continue
            user = self.get_user(str(report.get("userId", snapshot.id))) or {}
            cases.append({
                **report,
                "username": user.get("username", "未知使用者"),
                "distanceKm": round(distance, 2),
            })
        return sorted(cases, key=lambda item: (-item.get("urgencyLevel", 1), item["distanceKm"]))

    @staticmethod
    def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        radius = 6371.0
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dlat, dlon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
        value = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
        return radius * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))

    def save_user_status(self, status: schemas.UserStatusCreate) -> str:
        return self.save_user_status_bulk([status])[0]

    def save_user_status_bulk(self, records: Iterable[schemas.UserStatusCreate]) -> list[str]:
        db = self._get_db()
        collection = db.collection("user_status")
        saved_ids: list[str] = []
        records = list(records)
        for page in self._chunks(records, 450):
            batch = db.batch()
            for record in page:
                doc_ref = collection.document()
                payload = record.model_dump(mode="python")
                payload["server_timestamp"] = self._now()
                batch.set(doc_ref, payload)
                saved_ids.append(doc_ref.id)
            batch.commit()
        return saved_ids

    @staticmethod
    def _chunks(items, size: int):
        for index in range(0, len(items), size):
            yield items[index:index + size]

    def _get_db(self):
        if self._db is not None:
            return self._db
        try:
            import firebase_admin
            from firebase_admin import credentials, firestore
        except ImportError as exc:
            raise RuntimeError("firebase-admin is not installed") from exc

        if not firebase_admin._apps:
            credential = self._load_credential(credentials)
            project_id = os.getenv("FIREBASE_PROJECT_ID")
            options = {"projectId": project_id} if project_id else None
            firebase_admin.initialize_app(credential, options)
        self._db = firestore.client()
        return self._db

    def _load_credential(self, credentials):
        raw_json = os.getenv("FIREBASE_CREDENTIALS_JSON")
        if raw_json:
            return credentials.Certificate(json.loads(raw_json))
        path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH")
        if path:
            return credentials.Certificate(path)
        default = Path(__file__).resolve().parent.parent.parent / "firebase-service-account.json"
        return credentials.Certificate(str(default)) if default.is_file() else None


firebase_service = FirebaseService()
