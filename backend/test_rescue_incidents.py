import unittest

from Backend.services.firebase_service import FirebaseService


class Snapshot:
    def __init__(self, document_id, data):
        self.id = document_id
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return self._data


class Document:
    def __init__(self, collection, document_id):
        self.collection = collection
        self.id = document_id

    def get(self):
        return Snapshot(self.id, self.collection.documents.get(self.id))

    def set(self, data, merge=False):
        current = self.collection.documents.get(self.id, {}) if merge else {}
        self.collection.documents[self.id] = {**current, **data}

    def update(self, data):
        current = self.collection.documents[self.id]
        for key, value in data.items():
            if type(value).__name__ == "ArrayUnion":
                existing = current.get(key, [])
                current[key] = existing + [item for item in value._values if item not in existing]
            else:
                current[key] = value


class Collection:
    def __init__(self):
        self.documents = {}
        self.counter = 0

    def document(self, document_id=None):
        if document_id is None:
            self.counter += 1
            document_id = f"generated-{self.counter}"
        return Document(self, document_id)

    def stream(self):
        return [Snapshot(document_id, data) for document_id, data in self.documents.items()]


class MemoryFirestore:
    def __init__(self):
        self.collections = {}

    def collection(self, name):
        return self.collections.setdefault(name, Collection())


class RescueIncidentRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.repository = FirebaseService()
        self.repository._db = MemoryFirestore()

    def test_incident_keeps_multiple_earthquakes_and_add_is_idempotent(self):
        incident = self.repository.create_rescue_incident("rescue-user", "東區救援行動", "cwa:101:10:00")

        updated = self.repository.add_event_to_rescue_incident(incident["id"], "cwa:102:11:00")
        updated = self.repository.add_event_to_rescue_incident(incident["id"], "cwa:102:11:00")

        self.assertEqual(updated["event_keys"], ["cwa:101:10:00", "cwa:102:11:00"])
        self.assertEqual(updated["title"], "東區救援行動")

    def test_incident_report_query_returns_reports_from_each_linked_event(self):
        incident = self.repository.create_rescue_incident("rescue-user", "應變行動", "event-main")
        self.repository.add_event_to_rescue_incident(incident["id"], "event-aftershock")
        reports = self.repository._get_db().collection("earthquake_field_reports")
        reports.documents = {
            "report-main": {"earthquake_key": "event-main", "observed_at": "2026-10-28T10:00:00+00:00"},
            "report-aftershock": {"earthquake_key": "event-aftershock", "observed_at": "2026-10-28T11:00:00+00:00"},
            "report-unrelated": {"earthquake_key": "other-event", "observed_at": "2026-10-28T12:00:00+00:00"},
        }

        results = self.repository.list_earthquake_field_reports(incident_id=incident["id"])

        self.assertEqual({report["id"] for report in results}, {"report-main", "report-aftershock"})
        self.assertEqual(len(reports.documents), 3, "querying an incident must not alter source reports")

    def test_adding_event_to_missing_incident_returns_none(self):
        self.assertIsNone(self.repository.add_event_to_rescue_incident("missing", "event-1"))

    def test_creating_person_case_keeps_source_and_records_a_separate_link(self):
        from Backend.schemas import PersonRescueCaseCreateFromReport

        self.repository._get_db().collection("earthquake_field_reports").documents["report-1"] = {
            "earthquake_key": "event-1",
            "user_latitude": 24.1,
            "user_longitude": 121.2,
            "observation": "一名匿名民眾表示腳受傷",
        }

        case = self.repository.create_person_rescue_case_from_report(
            "rescue-user",
            "report-1",
            PersonRescueCaseCreateFromReport(label="匿名受災者 A", situation_summary="腳受傷"),
        )
        source = self.repository._get_field_report("report-1")
        reports = self.repository.list_earthquake_field_reports("event-1")

        self.assertEqual(case["status"], "待核實")
        self.assertEqual(case["earthquake_key"], "event-1")
        self.assertEqual(source["observation"], "一名匿名民眾表示腳受傷")
        self.assertEqual(reports[0]["links"][0]["target_id"], case["id"])
        self.assertEqual(reports[0]["links"][0]["target_type"], "case")

    def test_source_from_same_incident_can_link_to_case_across_events(self):
        from Backend.schemas import PersonRescueCaseCreateFromReport

        incident = self.repository.create_rescue_incident("rescue-user", "海岸救援", "event-main")
        self.repository.add_event_to_rescue_incident(incident["id"], "event-aftershock")
        report_collection = self.repository._get_db().collection("earthquake_field_reports")
        report_collection.documents = {
            "report-main": {"earthquake_key": "event-main", "user_latitude": 24.0, "user_longitude": 121.0},
            "report-aftershock": {"earthquake_key": "event-aftershock", "user_latitude": 24.0, "user_longitude": 121.0},
        }
        case = self.repository.create_person_rescue_case_from_report(
            "rescue-user",
            "report-main",
            PersonRescueCaseCreateFromReport(label="匿名受災者", incident_id=incident["id"]),
        )

        link = self.repository.link_field_report_to_target(
            "rescue-user", "report-aftershock", "case", case["id"], "協調員確認為同一人"
        )

        self.assertEqual(link["target_id"], case["id"])
        self.assertEqual(link["source_event_key"], "event-aftershock")

    def test_unrelated_event_cannot_be_linked_to_existing_person_case(self):
        from Backend.schemas import PersonRescueCaseCreateFromReport

        report_collection = self.repository._get_db().collection("earthquake_field_reports")
        report_collection.documents = {
            "report-1": {"earthquake_key": "event-1", "user_latitude": 24.0, "user_longitude": 121.0},
            "report-2": {"earthquake_key": "event-2", "user_latitude": 24.0, "user_longitude": 121.0},
        }
        case = self.repository.create_person_rescue_case_from_report(
            "rescue-user", "report-1", PersonRescueCaseCreateFromReport()
        )

        with self.assertRaises(ValueError):
            self.repository.link_field_report_to_target("rescue-user", "report-2", "case", case["id"])


if __name__ == "__main__":
    unittest.main()
