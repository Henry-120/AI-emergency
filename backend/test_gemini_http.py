import unittest
from unittest.mock import patch

import httpx

from Backend.services.gemini_http import post_gemini_with_retry


def make_response(status_code: int) -> httpx.Response:
    request = httpx.Request("POST", "https://example.test/generateContent")
    return httpx.Response(status_code, request=request, headers={"Retry-After": "0"})


class GeminiRetryTests(unittest.TestCase):
    class ImmediateAwaitable:
        def __init__(self, value=None, error=None):
            self.value = value
            self.error = error

        def __await__(self):
            if self.error:
                raise self.error
            if False:
                yield None
            return self.value

    class FakeClient:
        def __init__(self, outcomes):
            self.outcomes = list(outcomes)
            self.calls = 0

        def post(self, *args, **kwargs):
            self.calls += 1
            outcome = self.outcomes.pop(0)
            if isinstance(outcome, Exception):
                return GeminiRetryTests.ImmediateAwaitable(error=outcome)
            return GeminiRetryTests.ImmediateAwaitable(value=outcome)

    @staticmethod
    def run_immediately(coroutine):
        try:
            coroutine.send(None)
        except StopIteration as result:
            return result.value
        raise AssertionError("The fake Gemini request unexpectedly yielded control")

    def test_retries_temporary_503_and_returns_success(self):
        client = self.FakeClient([make_response(503), make_response(200)])

        with patch("Backend.services.gemini_http.asyncio.sleep", side_effect=lambda _: self.ImmediateAwaitable()):
            response = self.run_immediately(post_gemini_with_retry(
                client, "https://example.test/generateContent", params={}, json_body={}, operation="test"
            ))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(client.calls, 2)

    def test_does_not_retry_non_transient_client_error(self):
        client = self.FakeClient([make_response(400), make_response(200)])

        with patch("Backend.services.gemini_http.asyncio.sleep", side_effect=lambda _: self.ImmediateAwaitable()) as sleep:
            with self.assertRaises(httpx.HTTPStatusError):
                self.run_immediately(post_gemini_with_retry(
                    client, "https://example.test/generateContent", params={}, json_body={}, operation="test"
                ))

        self.assertEqual(client.calls, 1)
        sleep.assert_not_called()

    def test_retries_transport_failure(self):
        client = self.FakeClient([httpx.ConnectError("temporary"), make_response(200)])

        with patch("Backend.services.gemini_http.asyncio.sleep", side_effect=lambda _: self.ImmediateAwaitable()):
            response = self.run_immediately(post_gemini_with_retry(
                client, "https://example.test/generateContent", params={}, json_body={}, operation="test"
            ))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(client.calls, 2)


if __name__ == "__main__":
    unittest.main()
