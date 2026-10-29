import hashlib
import json
import os
import math
from datetime import datetime, timezone, timedelta
from pathlib import Path
from threading import Lock
from typing import Iterable
from uuid import uuid4

from .. import schemas
from .case_status import effective_condition, requires_rescue

# 一個帳號 24 小時內最多能釘選幾個災情，防止洗版。
HAZARD_PIN_DAILY_LIMIT = 30
# 沒有人更新的災情標記，地圖上顯示多久。
HAZARD_PIN_VISIBLE_FOR = timedelta(hours=72)


class HazardPinNotFoundError(LookupError):
    pass


class HazardPinPermissionError(PermissionError):
    pass


class HazardPinLimitError(RuntimeError):
    pass


# All service instances in this process share the default Firebase app.
_firebase_init_lock = Lock()


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
            transaction.set(username_ref, {"user_id": user_id, "user_name": username})
            if email_ref:
                transaction.set(email_ref, {"user_id": user_id, "user_name": username})
            return user

        user = create(db.transaction())
        db.collection("medical_cards").document(user_id).set({
            "user_id": user_id,
            "full_name": username,
            "user_name": username,
            "updated_at": now,
        })
        return user

    def get_user(self, user_id: str) -> dict | None:
        snapshot = self._get_db().collection("users").document(str(user_id)).get()
        return snapshot.to_dict() if snapshot.exists else None

    def _user_name(self, user_id: str | None) -> str | None:
        user = self.get_user(user_id) if user_id else None
        return user.get("username") if user else None

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
        card = {"user_id": user["id"], "full_name": user["username"], "user_name": user["username"], "updated_at": self._now()}
        ref.set(card)
        return card

    def update_medical_card(self, user_id: str, card: schemas.MedicalCardBase) -> dict:
        payload = card.model_dump()
        payload.update({"user_id": user_id, "user_name": self._user_name(user_id), "updated_at": self._now()})
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
        location = self._location_tuple(data.latitude, data.longitude)
        # AI 彙整只更新自己的欄位，本人在災情地圖上選的狀況不會被蓋掉。
        payload = self._write_case(
            user_id,
            lambda previous: {
                **summary,
                "aiUpdatedAt": now,
                **self._location_update(previous, location, now),
            },
        )
        report_ref = db.collection("emergency_reports").document(user_id)

        # Messages live in a subcollection. 
        # 改用內容雜湊產生固定 ID 並使用 merge=True，避免先刪後寫的雙倍成本與 Race Condition
        messages = report_ref.collection("chat_history")        
        for page in self._chunks(data.messages, 450):
            batch = db.batch()
            for message in page:
                # 利用時間戳與內容產生固定不變的 Document ID
                unique_str = f"{message.timestamp}_{message.role}_{message.content[:30]}"
                msg_id = hashlib.sha256(unique_str.encode("utf-8")).hexdigest()[:24]
                
                ref = messages.document(msg_id)
                batch.set(ref, {
                    "user_id": user_id,
                    "user_name": payload["user_name"],
                    "role": message.role,
                    "content": message.content,
                    "timestamp": message.timestamp or now,
                }, merge=True)
            batch.commit()
        return payload

    def update_self_condition(self, user_id: str, data: schemas.MyStatusUpdate) -> dict:
        """受難者在災情地圖或對話按鈕上自己標示的狀況。"""
        now = self._now()
        reported_at = now
        if data.reported_at is not None:
            reported = data.reported_at
            if reported.tzinfo is None:
                reported = reported.replace(tzinfo=timezone.utc)
            # 離線時先記下、恢復連線才送出的狀況用當時的時間；未來的或一天以前的不採用。
            if now - timedelta(hours=24) <= reported <= now:
                reported_at = reported
        location = self._location_tuple(data.latitude, data.longitude)

        def build(previous: dict) -> dict | None:
            known = previous.get("selfConditionAt")
            if known and known > reported_at:
                # 比已經記錄的狀況還舊（例如離線時記下、很晚才送到），不覆蓋較新的。
                return None
            return {
                "selfCondition": data.condition,
                "selfConditionAt": reported_at,
                **self._location_update(previous, location, reported_at),
            }

        return self._write_case(user_id, build)

    def _write_case(self, user_id: str, build_updates) -> dict:
        """更新救援摘要的一部分欄位，再依合併後的內容重算目前狀況和是否需要救援。

        AI 彙整和本人回報各寫各的欄位（merge），放在交易裡，同時寫入也不會互相蓋掉。
        build_updates 回傳 None 表示不必更新。
        """
        from firebase_admin import firestore

        db = self._get_db()
        ref = db.collection("emergency_reports").document(user_id)
        user_name = self._user_name(user_id)

        @firestore.transactional
        def run(transaction):
            snapshot = ref.get(transaction=transaction)
            previous = snapshot.to_dict() if snapshot.exists else {}
            updates = build_updates(previous)
            if updates is None:
                return previous
            payload = {"userId": user_id, "user_name": user_name, **updates}
            merged = {**previous, **payload}
            condition, source, condition_at = effective_condition(merged)
            payload.update({
                "condition": condition,
                "conditionSource": source,
                "conditionUpdatedAt": condition_at,
                "requiresRescue": requires_rescue(merged),
                "updatedAt": self._now(),
            })
            transaction.set(ref, payload, merge=True)
            return {**previous, **payload}

        return run(db.transaction())

    @staticmethod
    def _location_tuple(latitude: float | None, longitude: float | None) -> tuple[float, float] | None:
        return (latitude, longitude) if latitude is not None and longitude is not None else None

    @staticmethod
    def _location_update(previous: dict, location: tuple[float, float] | None, at: datetime) -> dict:
        """位置以最新送出的為準：沒有位置時不清掉舊的，晚到的舊位置也不覆蓋新的。"""
        if location is None:
            return {}
        known = previous.get("locationUpdatedAt")
        if known and known > at:
            return {}
        return {"latitude": location[0], "longitude": location[1], "locationUpdatedAt": at}

    @staticmethod
    def my_case_view(case: dict) -> dict:
        """給受難者自己看的摘要。狀況每次重算，改版前的舊資料也適用。"""
        condition, source, condition_at = effective_condition(case)
        return {
            "condition": condition,
            "conditionSource": source,
            "conditionUpdatedAt": condition_at,
            "selfCondition": case.get("selfCondition"),
            "selfConditionAt": case.get("selfConditionAt"),
            "requiresRescue": requires_rescue(case) if case else False,
            "hasLocation": case.get("latitude") is not None and case.get("longitude") is not None,
            "updatedAt": case.get("updatedAt"),
        }

    def get_emergency_report(self, user_id: str) -> dict | None:
        snapshot = self._get_db().collection("emergency_reports").document(user_id).get()
        return snapshot.to_dict() if snapshot.exists else None

    def get_nearby_rescue_cases(self, latitude: float, longitude: float, radius_km: float) -> list[dict]:
        db = self._get_db()
        cases = []
        
        # 1. 計算緯度 (Latitude) 邊界 (地球上 1 度緯度大約等於 111.32 公里)
        lat_delta = radius_km / 111.32
        min_lat = latitude - lat_delta
        max_lat = latitude + lat_delta

        # 2. 計算經度 (Longitude) 邊界 (經度距離會隨緯度變化，需乘上 cos(緯度))
        lon_delta = radius_km / (111.32 * math.cos(math.radians(latitude)))
        min_lon = longitude - lon_delta
        max_lon = longitude + lon_delta

        # 3. Firestore 查詢過濾 (注意：Firestore 限制只能對單一欄位做範圍查詢，因此我們選擇緯度)
        query = (
            db.collection("emergency_reports")
            .where("requiresRescue", "==", True)
            .where("latitude", ">=", min_lat)
            .where("latitude", "<=", max_lat)
        )

        for snapshot in query.stream():
            report = snapshot.to_dict()
            lat, lon = report.get("latitude"), report.get("longitude")
            if lat is None or lon is None:
                continue

            # 4. 經度過濾 (在 Python 中快速剔除方塊外的資料，極度輕量)
            if not (min_lon <= float(lon) <= max_lon):
                continue

            # 5. 最後才精算圓形半徑的實際距離
            distance = self._distance_km(latitude, longitude, float(lat), float(lon))
            if distance > radius_km:
                continue

            user = self.get_user(str(report.get("userId", snapshot.id))) or {}
            condition, condition_source, condition_at = effective_condition(report)
            cases.append({
                **report,
                "username": user.get("username", "未知使用者"),
                "distanceKm": round(distance, 2),
                # 受難者目前狀況（本人回報或 AI 推斷），給救援端顯示用。
                "condition": condition,
                "conditionSource": condition_source,
                "conditionUpdatedAt": condition_at,
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
        from google.cloud import firestore

        db = self._get_db()
        latest = {}
        for record in records:
            if not record.user_id or record.user_id in {"local-user", "test_user_001"} or "/" in record.user_id:
                raise ValueError("A real user ID is required")
            previous = latest.get(record.user_id)
            if previous is None or self._status_time(record.model_dump()) >= self._status_time(previous.model_dump()):
                latest[record.user_id] = record

        @firestore.transactional
        def update(transaction, ref, payload):
            snapshot = ref.get(transaction=transaction)
            if snapshot.exists:
                previous = snapshot.to_dict()
                if self._status_time(payload) < self._status_time(previous):
                    return
                fields = ("user_id", "heart_rate", "battery_level", "latitude", "longitude", "client_timestamp", "user_name")
                if all(previous.get(key) == payload.get(key) for key in fields):
                    return
            payload["server_timestamp"] = self._now()
            transaction.set(ref, payload)

        for user_id, record in latest.items():
            payload = record.model_dump(mode="python")
            payload["user_name"] = self._user_name(user_id)
            update(db.transaction(), db.collection("user_status").document(user_id), payload)
        return list(latest)

    @staticmethod
    def _status_time(payload):
        from datetime import timezone
        value = payload.get("client_timestamp") or payload.get("server_timestamp")
        if isinstance(value, str):
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if value is None:
            return datetime.min.replace(tzinfo=timezone.utc)
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value

    def save_earthquake_field_report(
        self, user_id: str, data: schemas.EarthquakeFieldReportCreate
    ) -> str:
        """保存經使用者確認安全後提供的第一手現場災情。"""
        ref = self._get_db().collection("earthquake_field_reports").document()
        payload = data.model_dump(mode="python")
        payload.update({
            "user_id": user_id,
            "user_name": self._user_name(user_id),
            "reporter_confirmed_safe": data.is_safe,
            "analysis_status": "pending",
            "server_timestamp": self._now(),
        })
        ref.set(payload)
        return ref.id

    def update_field_report_analysis(self, report_id: str, update: dict) -> None:
        self._get_db().collection("earthquake_field_reports").document(report_id).update(update)

    def nearby_field_reports(self, latitude: float, longitude: float, radius_km: float) -> list[dict]:
        # One range query avoids a composite index; bound history to the last 24 hours.
        query = (self._get_db().collection("earthquake_field_reports")
                 .where("server_timestamp", ">=", self._now() - timedelta(hours=24)))
        items = []
        for snapshot in query.stream():
            report = snapshot.to_dict()
            lat, lon = report.get("user_latitude"), report.get("user_longitude")
            if lat is None or lon is None:
                continue
            distance = self._distance_km(latitude, longitude, lat, lon)
            if distance > radius_km:
                continue
            analysis = report.get("analysis")
            items.append({
                "id": snapshot.id, "earthquake_key": report["earthquake_key"],
                "latitude": lat, "longitude": lon, "distance_km": round(distance, 2),
                "observation": report["observation"], "observed_at": report.get("observed_at"),
                "received_at": report["server_timestamp"],
                "analysis_status": report.get("analysis_status", "unavailable"),
                "analysis": analysis,
            })
        return sorted(items, key=lambda item: item["received_at"], reverse=True)[:300]

    def create_hazard_pin(self, user_id: str, data: schemas.HazardPinCreate) -> dict:
        """使用者在地圖上釘選一個災情（像 Google 地圖那樣），所有人都看得到。"""
        db = self._get_db()
        now = self._now()
        # 防止洗版：一個帳號 24 小時內最多 HAZARD_PIN_DAILY_LIMIT 個。單一欄位查詢，不需要複合索引。
        recent = [
            snapshot for snapshot in db.collection("hazard_pins").where("created_by", "==", user_id).stream()
            if (snapshot.to_dict().get("created_at") or now) >= now - timedelta(hours=24)
        ]
        if len(recent) >= HAZARD_PIN_DAILY_LIMIT:
            raise HazardPinLimitError(f"24 小時內最多只能標記 {HAZARD_PIN_DAILY_LIMIT} 個災情")
        ref = db.collection("hazard_pins").document()
        pin = {
            "category": data.category,
            "note": data.note.strip(),
            "latitude": data.latitude,
            "longitude": data.longitude,
            "created_by": user_id,
            "user_name": self._user_name(user_id),
            "created_at": now,
            "updated_at": now,
        }
        ref.set(pin)
        return self._hazard_pin_view(ref.id, pin, user_id)

    def update_hazard_pin(self, user_id: str, pin_id: str, data: schemas.HazardPinUpdate) -> dict:
        """只有標記的人自己能改（分類、說明、位置）。"""
        ref = self._get_db().collection("hazard_pins").document(pin_id)
        pin = self._own_hazard_pin(ref, user_id)
        updates = {key: value for key, value in data.model_dump(exclude_unset=True).items() if value is not None}
        if "note" in updates:
            updates["note"] = updates["note"].strip()
        updates["updated_at"] = self._now()
        ref.update(updates)
        return self._hazard_pin_view(pin_id, {**pin, **updates}, user_id)

    def delete_hazard_pin(self, user_id: str, pin_id: str) -> None:
        ref = self._get_db().collection("hazard_pins").document(pin_id)
        self._own_hazard_pin(ref, user_id)
        ref.delete()

    def nearby_hazard_pins(self, user_id: str, latitude: float, longitude: float, radius_km: float) -> list[dict]:
        """附近的災情標記；超過 HAZARD_PIN_VISIBLE_FOR 沒更新的不再顯示。"""
        cutoff = self._now() - HAZARD_PIN_VISIBLE_FOR
        query = self._get_db().collection("hazard_pins").where("updated_at", ">=", cutoff)
        pins = []
        for snapshot in query.stream():
            pin = snapshot.to_dict()
            distance = self._distance_km(latitude, longitude, float(pin["latitude"]), float(pin["longitude"]))
            if distance > radius_km:
                continue
            pins.append({**self._hazard_pin_view(snapshot.id, pin, user_id), "distance_km": round(distance, 2)})
        return sorted(pins, key=lambda item: item["updated_at"], reverse=True)[:300]

    @staticmethod
    def _own_hazard_pin(ref, user_id: str) -> dict:
        snapshot = ref.get()
        if not snapshot.exists:
            raise HazardPinNotFoundError("找不到這個災情標記，可能已經被刪除")
        pin = snapshot.to_dict()
        if pin.get("created_by") != user_id:
            raise HazardPinPermissionError("只能修改自己標記的災情")
        return pin

    @staticmethod
    def _hazard_pin_view(pin_id: str, pin: dict, user_id: str) -> dict:
        # 不回傳標記者的帳號或名字，只告訴使用者這是不是他自己標的。
        return {
            "id": pin_id,
            "category": pin["category"],
            "note": pin.get("note", ""),
            "latitude": pin["latitude"],
            "longitude": pin["longitude"],
            "created_at": pin["created_at"],
            "updated_at": pin.get("updated_at", pin["created_at"]),
            "mine": pin.get("created_by") == user_id,
        }

    def register_device_token(self, token: str, platform: str, user_id: str | None) -> None:
        ref = self._get_db().collection("device_tokens").document(token)
        now = self._now()
        ref.set({
            "token": token,
            "platform": platform,
            "user_id": user_id,
            "user_name": self._user_name(user_id),
            "created_at": now,
            "last_seen_at": now,
        }, merge=True)

    def unregister_device_token(self, token: str) -> None:
        self._get_db().collection("device_tokens").document(token).delete()

    def list_device_tokens(self) -> list[str]:
        return [doc.id for doc in self._get_db().collection("device_tokens").stream()]

    def remove_device_tokens(self, tokens: Iterable[str]) -> None:
        db = self._get_db()
        for page in self._chunks(list(tokens), 450):
            batch = db.batch()
            for token in page:
                batch.delete(db.collection("device_tokens").document(token))
            batch.commit()

    def get_last_notified_alert_key(self) -> str | None:
        snapshot = self._get_db().collection("push_state").document("last_notified").get()
        return snapshot.to_dict().get("alert_key") if snapshot.exists else None

    def set_last_notified_alert_key(self, key: str) -> None:
        self._get_db().collection("push_state").document("last_notified").set(
            {"alert_key": key, "notified_at": self._now()}
        )

    def get_last_test_push_key(self) -> str | None:
        snapshot = self._get_db().collection("push_state").document("last_test_notified").get()
        return snapshot.to_dict().get("value_key") if snapshot.exists else None

    def set_last_test_push_key(self, key: str) -> None:
        self._get_db().collection("push_state").document("last_test_notified").set(
            {"value_key": key, "notified_at": self._now()}
        )

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

        # FastAPI sync endpoints run concurrently in worker threads. Serialize
        # app/client creation and recheck the cached client after acquiring the lock.
        with _firebase_init_lock:
            if self._db is not None:
                return self._db
            try:
                app = firebase_admin.get_app()
            except ValueError:
                credential = self._load_credential(credentials)
                project_id = os.getenv("FIREBASE_PROJECT_ID")
                options = {"projectId": project_id} if project_id else None
                app = firebase_admin.initialize_app(credential, options)
            self._db = firestore.client(app=app)
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
