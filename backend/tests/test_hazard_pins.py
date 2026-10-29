"""使用者釘選的災情標記：新增、查附近、只能改刪自己的、每日上限（用記憶體版 Firestore）。"""

import unittest
from uuid import uuid4

from pydantic import ValidationError

from backend import schemas
from backend.services.firebase_service import (
    HAZARD_PIN_DAILY_LIMIT,
    FirebaseService,
    HazardPinLimitError,
    HazardPinNotFoundError,
    HazardPinPermissionError,
)


class _Snapshot:
    def __init__(self, doc_id, data):
        self.id, self._data, self.exists = doc_id, data, data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


class _Doc:
    def __init__(self, store, doc_id):
        self.store, self.id = store, doc_id

    def get(self):
        return _Snapshot(self.id, self.store.get(self.id))

    def set(self, data):
        self.store[self.id] = dict(data)

    def update(self, data):
        self.store[self.id] = {**self.store[self.id], **data}

    def delete(self):
        self.store.pop(self.id, None)


class _Query:
    def __init__(self, store, filters=()):
        self.store, self.filters = store, filters

    def where(self, field, op, value):
        return _Query(self.store, self.filters + ((field, op, value),))

    def stream(self):
        ops = {"==": lambda a, b: a == b, ">=": lambda a, b: a >= b}
        for doc_id, data in list(self.store.items()):
            if all(field in data and ops[op](data[field], value) for field, op, value in self.filters):
                yield _Snapshot(doc_id, data)


class _Collection(_Query):
    def document(self, doc_id=None):
        return _Doc(self.store, doc_id or uuid4().hex)


class _FakeDb:
    def __init__(self):
        self.pins = {}

    def collection(self, name):
        assert name == "hazard_pins", name
        return _Collection(self.pins)


def pin_input(**overrides):
    return schemas.HazardPinCreate(**{"category": "road", "note": "路面裂開", "latitude": 23.97, "longitude": 121.60, **overrides})


class HazardPinTests(unittest.TestCase):
    def setUp(self):
        self.service = FirebaseService()
        self.db = _FakeDb()
        self.service._db = self.db
        self.service._user_name = lambda user_id: f"name-{user_id}"

    def test_create_returns_own_pin_without_identity(self):
        pin = self.service.create_hazard_pin("a", pin_input(note="  路面裂開  "))
        self.assertTrue(pin["mine"])
        self.assertEqual(pin["note"], "路面裂開")
        self.assertNotIn("created_by", pin)
        stored = self.db.pins[pin["id"]]
        self.assertEqual((stored["created_by"], stored["user_name"]), ("a", "name-a"))

    def test_others_see_nearby_pins_but_not_who_made_them(self):
        near = self.service.create_hazard_pin("a", pin_input())
        self.service.create_hazard_pin("a", pin_input(latitude=25.03, longitude=121.56))  # 台北，太遠
        seen = self.service.nearby_hazard_pins("b", 23.97, 121.60, 10)
        self.assertEqual([pin["id"] for pin in seen], [near["id"]])
        self.assertFalse(seen[0]["mine"])
        self.assertNotIn("created_by", seen[0])
        self.assertNotIn("user_name", seen[0])
        schemas.HazardPinResponse(**seen[0])

    def test_only_owner_can_edit_or_delete(self):
        pin = self.service.create_hazard_pin("a", pin_input())
        with self.assertRaises(HazardPinPermissionError):
            self.service.update_hazard_pin("b", pin["id"], schemas.HazardPinUpdate(category="fire"))
        with self.assertRaises(HazardPinPermissionError):
            self.service.delete_hazard_pin("b", pin["id"])
        self.assertIn(pin["id"], self.db.pins)

    def test_owner_can_change_category_note_and_position(self):
        pin = self.service.create_hazard_pin("a", pin_input())
        updated = self.service.update_hazard_pin(
            "a", pin["id"], schemas.HazardPinUpdate(category="building", latitude=23.972),
        )
        self.assertEqual((updated["category"], updated["latitude"], updated["longitude"]), ("building", 23.972, 121.60))
        self.assertEqual(updated["note"], "路面裂開")

    def test_delete_and_missing_pin(self):
        pin = self.service.create_hazard_pin("a", pin_input())
        self.service.delete_hazard_pin("a", pin["id"])
        self.assertNotIn(pin["id"], self.db.pins)
        with self.assertRaises(HazardPinNotFoundError):
            self.service.delete_hazard_pin("a", pin["id"])

    def test_daily_limit_per_account(self):
        for _ in range(HAZARD_PIN_DAILY_LIMIT):
            self.service.create_hazard_pin("a", pin_input())
        with self.assertRaises(HazardPinLimitError):
            self.service.create_hazard_pin("a", pin_input())
        # 別的帳號不受影響。
        self.service.create_hazard_pin("b", pin_input())

    def test_input_validation(self):
        with self.assertRaises(ValidationError):
            pin_input(category="volcano")
        with self.assertRaises(ValidationError):
            pin_input(note="很" * 201)
        with self.assertRaises(ValidationError):
            pin_input(latitude=91)


if __name__ == "__main__":
    unittest.main()
