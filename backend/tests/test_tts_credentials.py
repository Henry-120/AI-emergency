import unittest
from unittest.mock import Mock, patch

from backend.services.tts_service import TTSService, SCOPES


class TTSCredentialsTests(unittest.TestCase):
    def test_cloud_run_uses_default_identity_without_key_file(self):
        service = TTSService()
        credentials = Mock()
        with patch.object(service, '_service_account_path', return_value=None), patch(
            'google.auth.default', return_value=(credentials, 'project')
        ) as default:
            self.assertIs(service._get_credentials(), credentials)
            self.assertIs(service._get_credentials(), credentials)
            default.assert_called_once_with(scopes=SCOPES)

    def test_explicit_key_file_still_supported(self):
        service = TTSService()
        credentials = Mock()
        with patch.object(service, '_service_account_path', return_value='/configured/key.json'), patch(
            'google.oauth2.service_account.Credentials.from_service_account_file', return_value=credentials
        ) as from_file:
            self.assertIs(service._get_credentials(), credentials)
            from_file.assert_called_once_with('/configured/key.json', scopes=SCOPES)
