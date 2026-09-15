import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from backend import main, auth
from backend.services import push_service


class EarthquakeDrillTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.secret = patch.object(auth, "SECRET", "private-test-secret")
        self.secret.start()
        self.addCleanup(self.secret.stop)

    def request_as(self, user_id, name="郭碩宏"):
        token = auth.create_token(user_id, name)
        return self.client.post("/api/earthquake/drill", headers={"Authorization": f"Bearer {token}"})

    @patch.object(main.push_service, "_send_push")
    def test_anonymous_cannot_send(self, send):
        self.assertEqual(self.client.post("/api/earthquake/drill").status_code, 401)
        send.assert_not_called()

    @patch.object(main.push_service, "_send_push")
    @patch.object(main.firebase_service, "get_user_by_username", return_value={"id": "owner"})
    @patch.object(main.firebase_service, "get_user", return_value={"id": "other", "username": "郭碩宏"})
    def test_matching_name_and_token_claim_cannot_bypass_id(self, get_user, lookup, send):
        self.assertEqual(self.request_as("other").status_code, 403)
        send.assert_not_called()

    @patch.object(main.push_service, "_send_push", return_value={"success": 2, "failure": 1})
    @patch.object(main.firebase_service, "get_user_by_username", return_value={"id": "owner"})
    @patch.object(main.firebase_service, "get_user", return_value={"id": "owner", "username": "郭碩宏"})
    def test_owner_sends_distinct_drill(self, get_user, lookup, send):
        response = self.request_as("owner")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["success"], 2)
        self.assertEqual(send.call_args.args[2]["type"], "earthquake_drill")
        self.assertIn("非真實地震", send.call_args.args[0])

    @patch.object(main.push_service, "_send_push")
    @patch.object(main.firebase_service, "get_user_by_username", return_value=None)
    @patch.object(main.firebase_service, "get_user", return_value={"id": "other"})
    def test_missing_owner_denies(self, get_user, lookup, send):
        self.assertEqual(self.request_as("other").status_code, 403)
        send.assert_not_called()

    @patch.object(main.firebase_service, "get_user", return_value={"id": "owner"})
    def test_default_secret_disables_broadcast(self, get_user):
        with patch.object(auth, "SECRET", "guardia-ai-dev-secret-change-me"):
            self.assertEqual(self.request_as("owner").status_code, 503)

    @patch.object(push_service.firebase_service, "list_device_tokens", return_value=[f"t{i}" for i in range(1001)])
    @patch.object(push_service.messaging, "send_each_for_multicast")
    def test_large_audience_is_batched(self, send, tokens):
        send.side_effect = lambda message: SimpleNamespace(
            responses=[SimpleNamespace(success=True) for _ in message.tokens],
            success_count=len(message.tokens), failure_count=0,
        )
        result = push_service._send_push("演練", "非真實地震", {"type": "earthquake_drill"})
        self.assertEqual([len(call.args[0].tokens) for call in send.call_args_list], [500, 500, 1])
        self.assertEqual(result, {"success": 1001, "failure": 0})


if __name__ == "__main__":
    unittest.main()
