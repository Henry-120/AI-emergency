import unittest
import httpx
from backend.services.ai_error import ai_error_info

class AIErrorTests(unittest.TestCase):
    def test_http_error_has_code_without_secret_or_response_text(self):
        request = httpx.Request('POST', 'https://example.com?key=secret')
        response = httpx.Response(503, request=request, json={'error': {'status': 'UNAVAILABLE', 'message': 'private medical data'}})
        info = ai_error_info(httpx.HTTPStatusError('secret', request=request, response=response))
        self.assertEqual(info['http_status'], 503)
        self.assertEqual(info['code'], 'UNAVAILABLE')
        self.assertNotIn('secret', str(info))
        self.assertNotIn('medical', str(info))

    def test_timeout_has_no_invented_http_status(self):
        info = ai_error_info(httpx.ReadTimeout('timeout'))
        self.assertEqual(info['code'], 'TIMEOUT')
        self.assertIsNone(info['http_status'])
