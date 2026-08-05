"""SOS relay backend keys loaded from the runtime environment.

Private keys must be injected by Secret Manager in Cloud Run and must never be
committed to source control. Public counterparts live in
``src/services/sos/sosKeys.ts`` so native clients can encrypt SOS payloads and
verify acknowledgements.
"""

import os


KEY_VERSION = int(os.getenv("SOS_KEY_VERSION", "1"))
ENCRYPTION_PRIVATE_KEY_PEM = os.getenv("SOS_ENCRYPTION_PRIVATE_KEY_PEM", "")
ACK_SIGNING_PRIVATE_KEY_PEM = os.getenv("SOS_ACK_SIGNING_PRIVATE_KEY_PEM", "")
