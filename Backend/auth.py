"""輕量級認證工具：密碼雜湊與簽章式 token。

刻意只使用 Python 標準函式庫 (hashlib / hmac / secrets)，
避免引入 passlib / python-jose / bcrypt 等額外相依套件，
讓後端在未安裝額外套件的環境也能直接啟動。
"""
import hashlib
import hmac
import os
import base64
import json
import time
import secrets

# token 簽章密鑰。正式部署請以環境變數 AUTH_SECRET 覆寫。
SECRET = os.getenv("AUTH_SECRET", "guardia-ai-dev-secret-change-me")

_PBKDF2_ROUNDS = 120_000
_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30  # 30 天


def hash_password(password: str) -> str:
    """以 PBKDF2-HMAC-SHA256 + 隨機 salt 雜湊密碼，輸出可儲存字串。"""
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${_PBKDF2_ROUNDS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, rounds, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(rounds)
        )
        return hmac.compare_digest(dk.hex(), hash_hex)
    except (ValueError, AttributeError):
        return False


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def create_token(user_id: int, username: str) -> str:
    """建立簽章式 token：payload.signature（HMAC-SHA256）。"""
    payload = {"uid": user_id, "username": username, "exp": int(time.time()) + _TOKEN_TTL_SECONDS}
    payload_b64 = _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = hmac.new(SECRET.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).digest()
    return f"{payload_b64}.{_b64url(sig)}"


def decode_token(token: str):
    """驗證 token 並回傳 payload，失敗回傳 None。"""
    try:
        payload_b64, sig_b64 = token.split(".")
        expected = hmac.new(
            SECRET.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256
        ).digest()
        if not hmac.compare_digest(_b64url(expected), sig_b64):
            return None
        payload = json.loads(_b64url_decode(payload_b64))
        if payload.get("exp", 0) < int(time.time()):
            return None
        return payload
    except (ValueError, KeyError, json.JSONDecodeError):
        return None
