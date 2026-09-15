import unittest
from backend.schemas import EarthquakeAssessmentRequest, EarthquakeAssessmentResponse
from backend.services.earthquake_response_service import earthquake_response_service


class PartialEarthquakeTests(unittest.TestCase):
    def test_no_optional_information_still_generates(self):
        result = earthquake_response_service.assess(EarthquakeAssessmentRequest())
        self.assertIsNone(result['distance_km'])
        self.assertEqual(result['impact_zone'], 'unknown')
        self.assertGreater(len(result['immediate_actions']), 0)
        EarthquakeAssessmentResponse(**result)

    def test_partial_coordinates_do_not_invent_distance(self):
        result = earthquake_response_service.assess(EarthquakeAssessmentRequest(
            user_latitude=25, battery_level=10, medical_summary='需攜帶藥物'))
        self.assertIsNone(result['distance_km'])
        self.assertTrue(any('低耗電' in item for item in result['immediate_actions']))
        self.assertTrue(any('藥物' in item for item in result['immediate_actions']))

    def test_complete_coordinates_keep_distance_rules(self):
        result = earthquake_response_service.assess(EarthquakeAssessmentRequest(
            user_latitude=25, user_longitude=121, epicenter_latitude=25, epicenter_longitude=121))
        self.assertEqual(result['distance_km'], 0)
        self.assertEqual(result['impact_zone'], 'epicentral')
