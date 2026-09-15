import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from backend.services.firebase_service import FirebaseService


class FirebaseInitializationTests(unittest.TestCase):
    def test_concurrent_first_requests_initialize_once(self):
        service = FirebaseService()
        barrier = threading.Barrier(12)
        app, client = object(), object()
        apps = []

        def get_app():
            if not apps:
                raise ValueError('No default app')
            return apps[0]

        def initialize(*args):
            if apps:
                raise ValueError('Default app already exists')
            apps.append(app)
            return app

        def request():
            barrier.wait(timeout=5)
            return service._get_db()

        with patch('firebase_admin.get_app', side_effect=get_app), \
             patch('firebase_admin.initialize_app', side_effect=initialize) as init, \
             patch('firebase_admin.firestore.client', return_value=client) as create_client, \
             patch.object(service, '_load_credential', return_value=None):
            with ThreadPoolExecutor(max_workers=12) as pool:
                results = list(pool.map(lambda _: request(), range(12)))
            self.assertTrue(all(result is client for result in results))
            init.assert_called_once()
            create_client.assert_called_once_with(app=app)

    def test_existing_default_app_is_reused(self):
        app = object()
        with patch('firebase_admin.get_app', return_value=app), \
             patch('firebase_admin.initialize_app') as init, \
             patch('firebase_admin.firestore.client', return_value=object()) as client:
            FirebaseService()._get_db()
            init.assert_not_called()
            client.assert_called_once_with(app=app)

    def test_client_failure_can_be_retried(self):
        service = FirebaseService()
        app, client = object(), object()
        with patch('firebase_admin.get_app', return_value=app), \
             patch('firebase_admin.firestore.client', side_effect=[RuntimeError('temporary'), client]):
            with self.assertRaises(RuntimeError):
                service._get_db()
            self.assertIsNone(service._db)
            self.assertIs(service._get_db(), client)
