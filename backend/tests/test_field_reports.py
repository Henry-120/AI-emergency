import asyncio
import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import Mock, patch, AsyncMock

from backend.schemas import FieldReportMapItem
from backend.services.firebase_service import FirebaseService
from backend.services.field_report_service import structure_field_report


class FieldReportTests(unittest.TestCase):
    def test_nearby_filters_distance_and_omits_private_data(self):
        now = datetime.now(timezone.utc)
        def snapshot(identifier, latitude, timestamp):
            return Mock(id=identifier, to_dict=lambda: {
                "earthquake_key": "quake", "user_latitude": latitude, "user_longitude": 121,
                "observation": "沒看到傷者", "server_timestamp": timestamp,
                "user_id": "secret", "user_name": "private", "heart_rate": 90,
            })
        query = Mock()
        query.stream.return_value = [snapshot("old", 25, now - timedelta(minutes=2)),
                                     snapshot("far", 23, now), snapshot("new", 25, now)]
        service = FirebaseService()
        service._db = Mock()
        service._db.collection.return_value.where.return_value = query
        result = service.nearby_field_reports(25, 121, 50)
        self.assertEqual([r["id"] for r in result], ["new", "old"])
        for row in result:
            item = FieldReportMapItem(**row)
            self.assertEqual(item.verification_status, "unverified")
            self.assertEqual(item.location_basis, "reporter")
            self.assertNotIn("user_id", row)
            self.assertNotIn("heart_rate", row)
            self.assertEqual(item.observation, "沒看到傷者")

    def test_ai_failure_preserves_raw_report(self):
        with patch.dict("os.environ", {"GEMINI_API_KEY": ""}), patch(
            "backend.services.firebase_service.firebase_service.update_field_report_analysis"
        ) as update:
            asyncio.run(structure_field_report("report", "沒看到傷者"))
            update.assert_called_once_with("report", {"analysis_status": "unavailable"})

    def test_validated_ai_result_is_saved(self):
        response = Mock()
        response.json.return_value = {"candidates": [{"content": {"parts": [{"text":
            '{"category":"road","summary":"路口部分受阻","impact":"部分受阻","location_description":"路口"}'
        }]}}]}
        with patch.dict("os.environ", {"GEMINI_API_KEY": "test"}), patch(
            "backend.services.field_report_service.generate_content", AsyncMock(return_value=response)
        ), patch("backend.services.firebase_service.firebase_service.update_field_report_analysis") as update:
            asyncio.run(structure_field_report("report", "路口部分受阻"))
            self.assertEqual(update.call_args.args[1]["analysis_status"], "ready")

    def test_invalid_ai_output_falls_back(self):
        response = Mock()
        response.json.return_value = {"candidates": [{"content": {"parts": [{"text": '{"category":"verified"}'}]}}]}
        with patch.dict("os.environ", {"GEMINI_API_KEY": "test"}), patch(
            "backend.services.field_report_service.generate_content", AsyncMock(return_value=response)
        ), patch("backend.services.firebase_service.firebase_service.update_field_report_analysis") as update:
            asyncio.run(structure_field_report("report", "觀察"))
            self.assertEqual(update.call_args.args[1], {"analysis_status": "unavailable"})
