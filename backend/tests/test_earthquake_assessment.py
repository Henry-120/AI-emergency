import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from backend import main


class EarthquakeAssessmentTests(unittest.TestCase):
    def setUp(self):
        main.app.dependency_overrides[main.get_current_user] = lambda: {"id": "test"}
        self.addCleanup(main.app.dependency_overrides.clear)
        self.client = TestClient(main.app)
        self.payload = {
            "user_latitude": 25, "user_longitude": 121,
            "epicenter_latitude": 25.5, "epicenter_longitude": 121,
            "magnitude": 6.5, "battery_level": 10, "heart_rate": 130,
            "medical_summary": "氣喘，攜帶吸入劑", "available_context": "周圍有玻璃",
        }

    def test_personal_context_and_safety_confirmation_are_returned(self):
        ai = AsyncMock(return_value={"environmentalWarnings": ["依醫療卡攜帶吸入劑，避開煙霧。"]})
        with patch.object(main.location_ai_service, 'analyze_risk', ai):
            response = self.client.post('/api/earthquake/assess', json=self.payload)
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertIn('吸入劑', result['environmental_warnings'][0])
        self.assertTrue(result['safety_question'])
        self.assertTrue(result['field_report_questions'])
        self.assertTrue(any('電量' in action for action in result['immediate_actions']))
        self.assertTrue(any('心率' in action for action in result['immediate_actions']))
        context = ai.call_args.args[0]
        for value in ['25', '130', '氣喘', '周圍有玻璃']:
            self.assertIn(value, context)

    def test_ai_timeout_still_returns_actions_and_safety_question(self):
        with patch.object(main.location_ai_service, 'analyze_risk', AsyncMock(side_effect=TimeoutError())):
            response = self.client.post('/api/earthquake/assess', json=self.payload)
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertTrue(result['ai_error'])
        self.assertTrue(result['immediate_actions'])
        self.assertTrue(result['safety_question'])
