"""受難者狀況合成規則的單元測試（不需要 Firestore）。"""

import unittest
from datetime import datetime, timedelta, timezone

from backend.services.case_status import ai_condition, effective_condition, requires_rescue

T0 = datetime(2026, 10, 27, 18, 14, tzinfo=timezone.utc)


def at(minutes: int) -> datetime:
    return T0 + timedelta(minutes=minutes)


TRAPPED_AI = {"isTrapped": True, "urgencyLevel": 9, "aiUpdatedAt": at(0)}


class AiConditionTest(unittest.TestCase):
    def test_maps_summary_fields(self):
        self.assertEqual(ai_condition({"isTrapped": True}), "trapped")
        self.assertEqual(ai_condition({"hasInjuries": True}), "injured")
        self.assertEqual(ai_condition({"injurySeverity": "severe"}), "injured")
        self.assertEqual(ai_condition({"rescueNeeds": ["醫療"]}), "need_help")
        self.assertEqual(ai_condition({"urgencyLevel": 8}), "need_help")
        self.assertIsNone(ai_condition({"injurySeverity": "minor", "urgencyLevel": 3}))
        self.assertIsNone(ai_condition({}))


class EffectiveConditionTest(unittest.TestCase):
    def test_ai_only_keeps_previous_behaviour(self):
        self.assertEqual(effective_condition(TRAPPED_AI)[:2], ("trapped", "ai"))
        self.assertTrue(requires_rescue(TRAPPED_AI))
        self.assertFalse(requires_rescue({"urgencyLevel": 3, "aiUpdatedAt": at(0)}))

    def test_newer_self_report_overrides_ai(self):
        case = {**TRAPPED_AI, "selfCondition": "safe", "selfConditionAt": at(10)}
        self.assertEqual(effective_condition(case)[:2], ("safe", "self"))
        self.assertFalse(requires_rescue(case))

    def test_newer_ai_can_escalate_self_report(self):
        case = {"selfCondition": "safe", "selfConditionAt": at(0), "isTrapped": True, "aiUpdatedAt": at(10)}
        self.assertEqual(effective_condition(case)[:2], ("trapped", "ai"))
        self.assertTrue(requires_rescue(case))

    def test_newer_ai_cannot_downgrade_self_report(self):
        # 受困的人問了別的問題，AI 這次沒判斷出受困，人不能從救援端消失。
        case = {"selfCondition": "trapped", "selfConditionAt": at(0), "isTrapped": False,
                "urgencyLevel": 2, "aiUpdatedAt": at(10)}
        self.assertEqual(effective_condition(case)[:2], ("trapped", "self"))
        self.assertTrue(requires_rescue(case))

    def test_condition_time_is_reported(self):
        case = {"selfCondition": "injured", "selfConditionAt": at(5)}
        self.assertEqual(effective_condition(case), ("injured", "self", at(5)))

    def test_no_signal_at_all(self):
        self.assertEqual(effective_condition({}), (None, None, None))
        self.assertFalse(requires_rescue({}))

    def test_self_conditions_and_rescue(self):
        for condition, expected in [("trapped", True), ("injured", True), ("need_supplies", True),
                                    ("safe", False), ("helping", False)]:
            with self.subTest(condition=condition):
                self.assertEqual(
                    requires_rescue({"selfCondition": condition, "selfConditionAt": at(0)}), expected)


if __name__ == "__main__":
    unittest.main()
