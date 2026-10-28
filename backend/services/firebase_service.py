import hashlib
import json
import os
import math
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from uuid import uuid4

from .. import schemas


PERSON_CASE_STATUS_TRANSITIONS = {
    "待核實": {"已確認需要救援", "已確認無需救援"},
    "已確認需要救援": {"待派遣", "已確認無需救援"},
    "已確認無需救援": {"結案"},
    "待派遣": {"已確認無需救援"},
    "已派遣": {"救援中", "待派遣"},
    # "待確認結果" is reached only when a field team submits a completed mission.
    "救援中": {"待派遣"},
    "待確認結果": {"已協助", "救援中"},
    "已協助": {"結案"},
    "結案": set(),
}


class FirebaseService:
    """Firestore repository used by every persistent backend API."""

    def __init__(self) -> None:
        self._db = None
        self._db_lock = threading.Lock()

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)

    @staticmethod
    def _index_id(value: str) -> str:
        return hashlib.sha256(value.strip().lower().encode("utf-8")).hexdigest()

    def create_user(
        self, username: str, email: str | None, password_hash: str,
        role: str = "user", team_id: str | None = None,
    ) -> dict:
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
                "role": role,
                "team_id": team_id,
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

    def set_user_role(self, user_id: str, role: str) -> dict | None:
        ref = self._get_db().collection("users").document(str(user_id))
        if not ref.get().exists:
            return None
        ref.set({"role": role}, merge=True)
        return self.get_user(user_id)

    def create_rescue_team(self, user_id: str, name: str) -> dict:
        db = self._get_db()
        team_id = uuid4().hex
        join_code = secrets.token_hex(6).upper()
        code_hash = self._index_id(join_code)
        now = self._now()
        team = {"name": name.strip(), "created_by": user_id, "created_at": now, "is_active": True}
        batch = db.batch()
        batch.set(db.collection("rescue_teams").document(team_id), team)
        batch.set(db.collection("rescue_team_invite_codes").document(code_hash), {"team_id": team_id, "is_active": True})
        batch.commit()
        return {"id": team_id, **team, "member_count": 0, "join_code": join_code}

    def get_rescue_team(self, team_id: str) -> dict | None:
        snapshot = self._get_db().collection("rescue_teams").document(team_id).get()
        if not snapshot.exists:
            return None
        return {"id": snapshot.id, **(snapshot.to_dict() or {})}

    def list_rescue_teams(self) -> list[dict]:
        db = self._get_db()
        member_counts: dict[str, int] = {}
        for member in db.collection("users").where("role", "==", "field").stream():
            team_id = (member.to_dict() or {}).get("team_id")
            if team_id:
                member_counts[team_id] = member_counts.get(team_id, 0) + 1
        teams = []
        for snapshot in db.collection("rescue_teams").stream():
            team = {"id": snapshot.id, **(snapshot.to_dict() or {})}
            if team.get("is_active", True):
                team["member_count"] = member_counts.get(snapshot.id, 0)
                teams.append(team)
        teams.sort(key=lambda item: item.get("name", "").casefold())
        return teams

    def list_rescue_team_members(self, team_id: str) -> list[dict]:
        members = []
        for snapshot in self._get_db().collection("users").stream():
            data = snapshot.to_dict() or {}
            if data.get("team_id") != team_id or data.get("role") != "field":
                continue
            members.append({"id": snapshot.id, "username": data.get("username", "未知隊員"),
                            "email": data.get("email"), "created_at": data.get("created_at"), "role": "field"})
        members.sort(key=lambda item: item["username"].casefold())
        return members

    def register_field_user(
        self, username: str, email: str | None, password_hash: str, team_code: str
    ) -> dict:
        team_code_hash = self._index_id(team_code.strip().upper())
        code_snapshot = self._get_db().collection("rescue_team_invite_codes").document(team_code_hash).get()
        if not code_snapshot.exists or not (code_snapshot.to_dict() or {}).get("is_active"):
            raise ValueError("team_code_invalid")
        team_id = (code_snapshot.to_dict() or {}).get("team_id")
        team = self.get_rescue_team(str(team_id or ""))
        if not team or not team.get("is_active", True):
            raise ValueError("team_code_invalid")
        return self.create_user(username, email, password_hash, role="field", team_id=team["id"])

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
        existing_report = report_ref.get().to_dict() or {}
        if existing_report.get("rescueStatus"):
            payload["rescueStatus"] = existing_report["rescueStatus"]
        report_ref.set(payload)

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
                    "role": message.role,
                    "content": message.content,
                    "timestamp": message.timestamp or now,
                }, merge=True)
            batch.commit()
        return payload

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
            cases.append({
                **report,
                "caseId": snapshot.id,
                "status": report.get("rescueStatus", "待處理"),
                "username": user.get("username", "未知使用者"),
                "distanceKm": round(distance, 2),
            })

        return sorted(cases, key=lambda item: (-item.get("urgencyLevel", 1), item["distanceKm"]))

    def get_nearby_person_rescue_cases(
        self, latitude: float, longitude: float, radius_km: float
    ) -> list[dict]:
        """回傳指定半徑內、由協調端建立的個人救援案件。"""
        db = self._get_db()
        lat_delta = radius_km / 111.32
        min_lat, max_lat = latitude - lat_delta, latitude + lat_delta
        cosine = max(abs(math.cos(math.radians(latitude))), 1e-6)
        lon_delta = radius_km / (111.32 * cosine)
        min_lon, max_lon = longitude - lon_delta, longitude + lon_delta
        query = (
            db.collection("rescue_cases")
            .where("latitude", ">=", min_lat)
            .where("latitude", "<=", max_lat)
        )
        cases = []
        for snapshot in query.stream():
            data = snapshot.to_dict() or {}
            try:
                case_lat = float(data["latitude"])
                case_lon = float(data["longitude"])
            except (KeyError, TypeError, ValueError):
                continue
            if not min_lon <= case_lon <= max_lon:
                continue
            distance = self._distance_km(latitude, longitude, case_lat, case_lon)
            if distance > radius_km:
                continue
            cases.append({"id": snapshot.id, **data})
        return sorted(cases, key=lambda item: (-int(item.get("priority", 1)), self._distance_km(
            latitude, longitude, float(item["latitude"]), float(item["longitude"])
        )))

    def create_rescue_incident(self, user_id: str, title: str, earthquake_key: str) -> dict:
        """建立一個救援行動群組，保留其所涵蓋的地震事件 key。"""
        db = self._get_db()
        now = self._now()
        ref = db.collection("rescue_incidents").document()
        incident = {
            "title": title.strip(),
            "event_keys": [earthquake_key],
            "status": "active",
            "created_by": user_id,
            "created_at": now,
            "updated_at": now,
        }
        ref.set(incident)
        return {"id": ref.id, **incident}

    def get_rescue_incident(self, incident_id: str) -> dict | None:
        snapshot = self._get_db().collection("rescue_incidents").document(incident_id).get()
        if not snapshot.exists:
            return None
        return {"id": snapshot.id, **(snapshot.to_dict() or {})}

    def list_rescue_incidents(self, limit: int = 100) -> list[dict]:
        collection = self._get_db().collection("rescue_incidents")
        incidents = []
        for snapshot in collection.stream():
            incident = {"id": snapshot.id, **(snapshot.to_dict() or {})}
            if incident.get("status", "active") == "active":
                incidents.append(incident)
        incidents.sort(key=lambda item: item.get("updated_at") or self._now(), reverse=True)
        return incidents[:max(1, min(limit, 200))]

    def add_event_to_rescue_incident(self, incident_id: str, earthquake_key: str) -> dict | None:
        ref = self._get_db().collection("rescue_incidents").document(incident_id)
        if not ref.get().exists:
            return None
        from firebase_admin.firestore import ArrayUnion

        ref.update({
            "event_keys": ArrayUnion([earthquake_key]),
            "updated_at": self._now(),
        })
        return self.get_rescue_incident(incident_id)

    def _get_field_report(self, report_id: str) -> dict | None:
        snapshot = self._get_db().collection("earthquake_field_reports").document(report_id).get()
        if not snapshot.exists:
            return None
        return {"id": snapshot.id, **(snapshot.to_dict() or {})}

    def _validate_event_in_incident(self, incident_id: str | None, earthquake_key: str) -> None:
        if not incident_id:
            return
        incident = self.get_rescue_incident(incident_id)
        if not incident:
            raise ValueError("找不到指定的救援行動")
        if earthquake_key not in (incident.get("event_keys") or []):
            raise ValueError("此地震事件不屬於指定的救援行動")

    def create_rescue_site_from_report(
        self, user_id: str, report_id: str, data: schemas.RescueSiteCreateFromReport
    ) -> dict | None:
        report = self._get_field_report(report_id)
        if not report:
            return None
        earthquake_key = str(report.get("earthquake_key") or "")
        if not earthquake_key:
            raise ValueError("回報缺少地震事件識別碼")
        self._validate_event_in_incident(data.incident_id, earthquake_key)
        now = self._now()
        ref = self._get_db().collection("rescue_sites").document()
        site = {
            "title": data.title.strip(),
            "description": data.description.strip(),
            "earthquake_key": earthquake_key,
            "incident_id": data.incident_id,
            "latitude": float(report["user_latitude"]),
            "longitude": float(report["user_longitude"]),
            "status": "待查證",
            "created_by": user_id,
            "created_at": now,
            "updated_at": now,
        }
        ref.set(site)
        self.link_field_report_to_target(user_id, report_id, "site", ref.id, "從現場回報建立現場")
        return {"id": ref.id, **site}

    def create_person_rescue_case_from_report(
        self, user_id: str, report_id: str, data: schemas.PersonRescueCaseCreateFromReport
    ) -> dict | None:
        report = self._get_field_report(report_id)
        if not report:
            return None
        earthquake_key = str(report.get("earthquake_key") or "")
        if not earthquake_key:
            raise ValueError("回報缺少地震事件識別碼")

        incident_id = data.incident_id
        if data.site_id:
            site = self._get_db().collection("rescue_sites").document(data.site_id).get()
            if not site.exists:
                raise ValueError("找不到指定的救援現場")
            site_data = site.to_dict() or {}
            if site_data.get("earthquake_key") != earthquake_key:
                self._validate_event_in_incident(site_data.get("incident_id"), earthquake_key)
                if not site_data.get("incident_id"):
                    raise ValueError("救援現場與來源回報不屬於同一地震事件或救援行動")
            if incident_id and site_data.get("incident_id") and incident_id != site_data.get("incident_id"):
                raise ValueError("個人案件與救援現場不能分屬不同救援行動")
            incident_id = incident_id or site_data.get("incident_id")
        self._validate_event_in_incident(incident_id, earthquake_key)

        now = self._now()
        ref = self._get_db().collection("rescue_cases").document()
        case = {
            "label": data.label.strip(),
            "situation_summary": data.situation_summary.strip(),
            "earthquake_key": earthquake_key,
            "incident_id": incident_id,
            "site_id": data.site_id,
            "latitude": float(report["user_latitude"]),
            "longitude": float(report["user_longitude"]),
            "priority": data.priority,
            "status": "待核實",
            "created_by": user_id,
            "created_at": now,
            "updated_at": now,
            "status_history": [],
        }
        ref.set(case)
        self.link_field_report_to_target(user_id, report_id, "case", ref.id, "從現場回報建立個人案件")
        return {"id": ref.id, **case}

    def list_person_rescue_cases(
        self, earthquake_key: str | None = None, incident_id: str | None = None
    ) -> list[dict]:
        cases = []
        for snapshot in self._get_db().collection("rescue_cases").stream():
            case = {"id": snapshot.id, **(snapshot.to_dict() or {})}
            if earthquake_key and case.get("earthquake_key") != earthquake_key:
                continue
            if incident_id and case.get("incident_id") != incident_id:
                continue
            cases.append(case)
        cases.sort(key=lambda item: item.get("updated_at") or self._now(), reverse=True)
        return cases

    def update_person_rescue_case_status(
        self, user_id: str, case_id: str, status: str
    ) -> dict | None:
        ref = self._get_db().collection("rescue_cases").document(case_id)
        snapshot = ref.get()
        if not snapshot.exists:
            return None
        case = snapshot.to_dict() or {}
        current_status = str(case.get("status") or "待核實")
        allowed = PERSON_CASE_STATUS_TRANSITIONS.get(current_status)
        if allowed is None:
            raise ValueError(f"案件目前狀態「{current_status}」不在可辨識的流程中")
        if status not in allowed:
            raise ValueError(f"不可由「{current_status}」直接轉換為「{status}」")

        now = self._now()
        history_entry = {
            "from_status": current_status,
            "to_status": status,
            "updated_by": user_id,
            "updated_at": now,
        }
        from firebase_admin.firestore import ArrayUnion

        ref.update({
            "status": status,
            "status_history": ArrayUnion([history_entry]),
            "status_updated_by": user_id,
            "status_updated_at": now,
            "updated_at": now,
        })
        return {"id": case_id, **case, "status": status,
                "status_history": [*(case.get("status_history") or []), history_entry],
                "updated_at": now}

    def create_rescue_mission(
        self, user_id: str, data: schemas.RescueMissionCreate
    ) -> dict:
        """建立派遣任務，並原子性地把待派遣案件更新為已派遣。"""
        from firebase_admin import firestore
        from firebase_admin.firestore import ArrayUnion

        db = self._get_db()
        case_ref = db.collection("rescue_cases").document(data.case_id)
        team_ref = db.collection("rescue_teams").document(data.team_id)
        mission_ref = db.collection("rescue_missions").document()
        transaction = db.transaction()
        now = self._now()

        @firestore.transactional
        def create_in_transaction(tx):
            team_snapshot = team_ref.get(transaction=tx)
            case_snapshot = case_ref.get(transaction=tx)
            if not team_snapshot.exists or not (team_snapshot.to_dict() or {}).get("is_active", True):
                raise ValueError("找不到有效的受派隊伍")
            if not case_snapshot.exists:
                raise ValueError("找不到個人救援案件")
            case = case_snapshot.to_dict() or {}
            current_status = str(case.get("status") or "待核實")
            if current_status != "待派遣":
                raise ValueError("只有狀態為「待派遣」的案件可以建立派遣任務")

            mission = {
                "case_id": data.case_id,
                "title": data.title.strip(),
                "team_id": data.team_id,
                "team_name": (team_snapshot.to_dict() or {}).get("name", "救援隊"),
                "case_label": case.get("label", "匿名受災者"),
                "case_summary": case.get("situation_summary", ""),
                "instructions": data.instructions.strip(),
                "earthquake_key": case.get("earthquake_key", ""),
                "incident_id": case.get("incident_id"),
                "site_id": case.get("site_id"),
                "latitude": float(case["latitude"]),
                "longitude": float(case["longitude"]),
                "status": "待隊伍確認",
                "created_by": user_id,
                "assigned_at": now,
                "created_at": now,
                "updated_at": now,
                "status_history": [],
            }
            history_entry = {
                "from_status": current_status,
                "to_status": "已派遣",
                "updated_by": user_id,
                "updated_at": now,
                "reason": "建立救援派遣任務",
                "mission_id": mission_ref.id,
            }
            tx.set(mission_ref, mission)
            tx.update(case_ref, {
                "status": "已派遣",
                "status_history": ArrayUnion([history_entry]),
                "status_updated_by": user_id,
                "status_updated_at": now,
                "updated_at": now,
            })
            return {"id": mission_ref.id, **mission}

        return create_in_transaction(transaction)

    def list_rescue_missions(
        self, case_id: str | None = None, team_id: str | None = None, limit: int = 200
    ) -> list[dict]:
        missions = []
        for snapshot in self._get_db().collection("rescue_missions").stream():
            mission = {"id": snapshot.id, **(snapshot.to_dict() or {})}
            if case_id and mission.get("case_id") != case_id:
                continue
            if team_id and mission.get("team_id") != team_id:
                continue
            missions.append(mission)
        missions.sort(key=lambda item: item.get("assigned_at") or item.get("created_at") or self._now(), reverse=True)
        return missions[:max(1, min(limit, 500))]

    def update_rescue_mission_status(
        self, user_id: str, team_id: str, mission_id: str,
        status: str, note: str = "",
    ) -> dict | None:
        from firebase_admin import firestore
        from firebase_admin.firestore import ArrayUnion

        transitions = {
            "待隊伍確認": {"已接受", "已拒絕"},
            "已接受": {"前往現場"},
            "前往現場": {"已抵達"},
            "已抵達": {"任務完成"},
            "任務完成": set(),
            "已拒絕": set(),
        }
        if status in {"任務完成", "已拒絕"} and not note.strip():
            raise ValueError("請填寫處置結果或拒絕原因")

        db = self._get_db()
        mission_ref = db.collection("rescue_missions").document(mission_id)
        transaction = db.transaction()
        now = self._now()

        @firestore.transactional
        def update_in_transaction(tx):
            mission_snapshot = mission_ref.get(transaction=tx)
            if not mission_snapshot.exists:
                return None
            mission = mission_snapshot.to_dict() or {}
            if mission.get("team_id") != team_id:
                raise PermissionError("此任務不屬於你的隊伍")
            current_status = str(mission.get("status") or "待隊伍確認")
            if status not in transitions.get(current_status, set()):
                raise ValueError(f"不可由「{current_status}」轉換為「{status}」")

            case_ref = db.collection("rescue_cases").document(str(mission.get("case_id") or ""))
            case_snapshot = case_ref.get(transaction=tx)
            case = case_snapshot.to_dict() or {} if case_snapshot.exists else {}
            mission_entry = {
                "from_status": current_status,
                "to_status": status,
                "updated_by": user_id,
                "updated_at": now,
                "note": note.strip(),
            }
            tx.update(mission_ref, {
                "status": status,
                "status_history": ArrayUnion([mission_entry]),
                "status_updated_by": user_id,
                "status_updated_at": now,
                "updated_at": now,
            })

            case_transition = {
                "前往現場": ("已派遣", "救援中"),
                "任務完成": ("救援中", "待確認結果"),
                "已拒絕": ("已派遣", "待派遣"),
            }.get(status)
            if case_transition and case:
                expected, next_status = case_transition
                if case.get("status") == expected:
                    case_entry = {
                        "from_status": expected,
                        "to_status": next_status,
                        "updated_by": user_id,
                        "updated_at": now,
                        "reason": f"任務狀態更新為「{status}」",
                        "mission_id": mission_id,
                    }
                    tx.update(case_ref, {
                        "status": next_status,
                        "status_history": ArrayUnion([case_entry]),
                        "status_updated_by": user_id,
                        "status_updated_at": now,
                        "updated_at": now,
                    })
            return {"id": mission_id, **mission, "status": status,
                    "status_history": [*(mission.get("status_history") or []), mission_entry],
                    "updated_at": now}

        return update_in_transaction(transaction)

    def list_rescue_sites(
        self, earthquake_key: str | None = None, incident_id: str | None = None
    ) -> list[dict]:
        sites = []
        for snapshot in self._get_db().collection("rescue_sites").stream():
            site = {"id": snapshot.id, **(snapshot.to_dict() or {})}
            if earthquake_key and site.get("earthquake_key") != earthquake_key:
                continue
            if incident_id and site.get("incident_id") != incident_id:
                continue
            sites.append(site)
        sites.sort(key=lambda item: item.get("updated_at") or self._now(), reverse=True)
        return sites

    def link_field_report_to_target(
        self,
        user_id: str,
        report_id: str,
        target_type: str,
        target_id: str,
        note: str = "",
    ) -> dict | None:
        report = self._get_field_report(report_id)
        if not report:
            return None
        if target_type not in {"site", "case"}:
            raise ValueError("無效的連結目標類型")
        target_collection = "rescue_sites" if target_type == "site" else "rescue_cases"
        target_snapshot = self._get_db().collection(target_collection).document(target_id).get()
        if not target_snapshot.exists:
            raise ValueError("找不到要連結的現場或個人案件")
        target = target_snapshot.to_dict() or {}
        source_event_key = str(report.get("earthquake_key") or "")
        target_event_key = str(target.get("earthquake_key") or "")
        if not source_event_key or not target_event_key:
            raise ValueError("來源回報或目標缺少地震事件識別碼")
        if source_event_key != target_event_key:
            incident_id = target.get("incident_id")
            self._validate_event_in_incident(incident_id, target_event_key)
            self._validate_event_in_incident(incident_id, source_event_key)
            if not incident_id:
                raise ValueError("來源回報與目標不屬於同一地震事件或救援行動")

        source_type = "earthquake_field_reports"
        relation_id = hashlib.sha256(
            f"{source_type}|{report_id}|{target_type}|{target_id}".encode("utf-8")
        ).hexdigest()
        now = self._now()
        relation = {
            "source_type": source_type,
            "source_id": report_id,
            "source_event_key": source_event_key,
            "target_type": target_type,
            "target_id": target_id,
            "target_label": target.get("label") or target.get("title") or target_id,
            "note": note.strip(),
            "linked_by": user_id,
            "linked_at": now,
        }
        self._get_db().collection("rescue_report_links").document(relation_id).set(relation, merge=True)
        return {"id": relation_id, **relation}

    def list_earthquake_field_reports(
        self,
        earthquake_key: str | None = None,
        limit: int = 200,
        incident_id: str | None = None,
    ) -> list[dict]:
        collection = self._get_db().collection("earthquake_field_reports")
        links_by_report: dict[str, list[dict]] = {}
        for link_snapshot in self._get_db().collection("rescue_report_links").stream():
            link = link_snapshot.to_dict() or {}
            if link.get("source_type") != "earthquake_field_reports":
                continue
            links_by_report.setdefault(str(link.get("source_id")), []).append({
                "id": link_snapshot.id,
                "target_type": link.get("target_type"),
                "target_id": link.get("target_id"),
                "target_label": link.get("target_label"),
                "note": link.get("note", ""),
            })
        incident_event_keys = None
        if incident_id:
            incident = self.get_rescue_incident(incident_id)
            incident_event_keys = set((incident or {}).get("event_keys") or [])
        reports = []
        for snapshot in collection.stream():
            item = snapshot.to_dict() or {}
            if earthquake_key and item.get("earthquake_key") != earthquake_key:
                continue
            if incident_id and item.get("earthquake_key") not in incident_event_keys:
                continue
            item["id"] = snapshot.id
            item["status"] = item.get("rescue_status", "待確認")
            item["links"] = links_by_report.get(snapshot.id, [])
            reports.append(item)
        def report_time(item: dict) -> float:
            value = item.get("observed_at") or item.get("server_timestamp")
            if isinstance(value, datetime):
                return value.timestamp()
            if isinstance(value, str):
                try:
                    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
                except ValueError:
                    pass
            return 0.0

        reports.sort(key=report_time, reverse=True)
        return reports[:max(1, min(limit, 500))]

    def update_rescue_status(self, case_id: str, status: str) -> bool:
        db = self._get_db()
        for collection_name, field_name in (("emergency_reports", "rescueStatus"), ("earthquake_field_reports", "rescue_status"), ("sos_reports", "rescue_status")):
            ref = db.collection(collection_name).document(case_id)
            snapshot = ref.get()
            if snapshot.exists:
                ref.set({field_name: status, "rescue_status_updated_at": self._now()}, merge=True)
                return True
        return False

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

    def save_earthquake_field_report(
        self, user_id: str, data: schemas.EarthquakeFieldReportCreate
    ) -> str:
        """保存經使用者確認安全後提供的第一手現場災情。"""
        # 同一台裝置在離線後可能重試上傳。使用 client_report_id 作為同一名
        # 使用者的冪等鍵，避免網路回應遺失時產生兩份相同的第一手回報。
        document_id = (
            f"{user_id}_{data.client_report_id}"
            if data.client_report_id
            else None
        )
        collection = self._get_db().collection("earthquake_field_reports")
        ref = collection.document(document_id) if document_id else collection.document()
        payload = data.model_dump(mode="python")
        payload.update({
            "user_id": user_id,
            "reporter_confirmed_safe": data.is_safe,
            "server_timestamp": self._now(),
        })
        ref.set(payload, merge=True)
        return ref.id

    def register_device_token(self, token: str, platform: str, user_id: str | None) -> None:
        ref = self._get_db().collection("device_tokens").document(token)
        now = self._now()
        ref.set({
            "token": token,
            "platform": platform,
            "user_id": user_id,
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

        # 同步端點跑在 threadpool，多個請求會同時進來。沒有鎖的話兩條執行緒
        # 會同時看到 _apps 是空的，第二個 initialize_app() 就會拋
        # "The default Firebase app already exists"，變成 500。
        with self._db_lock:
            if self._db is not None:
                return self._db
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
        # 支援專案使用的 FIREBASE_CREDENTIALS，也相容 Google/Firebase 慣用名稱。
        # .env 可放在 Backend，金鑰檔也可放在 Backend；相對路徑會以該目錄解析，
        # 不受 uvicorn 從專案根目錄或 Backend 啟動的工作目錄影響。
        path = (
            os.getenv("FIREBASE_CREDENTIALS")
            or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
            or os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH")
        )
        if path:
            candidate = Path(path)
            if not candidate.is_absolute():
                backend_candidate = Path(__file__).resolve().parent.parent / candidate
                if backend_candidate.is_file():
                    candidate = backend_candidate
            return credentials.Certificate(str(candidate))
        default = Path(__file__).resolve().parent.parent.parent / "firebase-service-account.json"
        return credentials.Certificate(str(default)) if default.is_file() else None


firebase_service = FirebaseService()
