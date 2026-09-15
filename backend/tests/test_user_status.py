import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch
from backend.services.firebase_service import FirebaseService
from backend.schemas import UserStatusCreate

class UserStatusTests(unittest.TestCase):
    def test_newest_record_writes_account_document_once(self):
        service = FirebaseService()
        db = MagicMock()
        service._db = db
        service._user_name = lambda user_id: "Test account"
        ref = db.collection.return_value.document.return_value
        ref.get.return_value.exists = False
        now = datetime.now(timezone.utc)
        records = [UserStatusCreate(user_id='account-a',heart_rate=72,battery_level=b,client_timestamp=t)
                   for b,t in [(60,now),(80,now-timedelta(hours=1))]]
        with patch('google.cloud.firestore.transactional', side_effect=lambda fn: fn):
            self.assertEqual(service.save_user_status_bulk(records), ['account-a'])
        db.collection.return_value.document.assert_called_once_with('account-a')
        self.assertEqual(db.transaction.return_value.set.call_args.args[1]['battery_level'],60)
        db.transaction.return_value.set.assert_called_once()

    def test_stale_offline_status_does_not_overwrite_newer(self):
        service = FirebaseService()
        db = MagicMock()
        service._db = db
        service._user_name = lambda user_id: "Test account"
        ref = db.collection.return_value.document.return_value
        ref.get.return_value.exists = True
        now = datetime.now(timezone.utc)
        ref.get.return_value.to_dict.return_value={'client_timestamp':now}
        record=UserStatusCreate(user_id='account-a',heart_rate=72,battery_level=80,client_timestamp=now-timedelta(hours=1))
        with patch('google.cloud.firestore.transactional', side_effect=lambda fn: fn):
            service.save_user_status(record)
        db.transaction.return_value.set.assert_not_called()

    def test_placeholder_is_rejected(self):
        service = FirebaseService()
        service._db = MagicMock()
        with self.assertRaises(ValueError):
            service.save_user_status(UserStatusCreate(user_id='local-user',heart_rate=72,battery_level=80))
