import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from .. import schemas


class FirebaseService:
    def __init__(self) -> None:
        self._db = None

    def save_user_status(self, status: schemas.UserStatusCreate) -> str:
        records = self.save_user_status_bulk([status])
        return records[0]

    def save_user_status_bulk(
        self, records: Iterable[schemas.UserStatusCreate]
    ) -> list[str]:
        db = self._get_db()
        collection = db.collection("user_status")
        saved_ids: list[str] = []
        batch = db.batch()
        batch_size = 0

        for record in records:
            doc_ref = collection.document()
            batch.set(doc_ref, self._status_payload(record))
            saved_ids.append(doc_ref.id)
            batch_size += 1

            if batch_size == 500:
                batch.commit()
                batch = db.batch()
                batch_size = 0

        if batch_size:
            batch.commit()

        return saved_ids

    def _get_db(self):
        if self._db is not None:
            return self._db

        try:
            import firebase_admin
            from firebase_admin import credentials, firestore
        except ImportError as exc:
            raise RuntimeError(
                "firebase-admin is not installed. Install it with: pip install firebase-admin"
            ) from exc

        if not firebase_admin._apps:
            credential = self._load_credential(credentials)
            if credential is None:
                firebase_admin.initialize_app()
            else:
                firebase_admin.initialize_app(credential)

        self._db = firestore.client()
        return self._db

    def _load_credential(self, credentials):
        service_account_json = os.getenv("FIREBASE_CREDENTIALS_JSON")
        if service_account_json:
            return credentials.Certificate(json.loads(service_account_json))

        service_account_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH")
        if service_account_path:
            return credentials.Certificate(service_account_path)

        default_path = Path(__file__).resolve().parent.parent.parent / "firebase-service-account.json"
        if default_path.exists():
            return credentials.Certificate(str(default_path))

        return None

    def _status_payload(self, status: schemas.UserStatusCreate) -> dict:
        payload = status.model_dump(mode="json")
        payload["server_timestamp"] = datetime.now(timezone.utc).isoformat()
        return payload


firebase_service = FirebaseService()
