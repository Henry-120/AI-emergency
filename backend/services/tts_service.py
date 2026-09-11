"""Google Cloud Text-to-Speech，由後端代打。

金鑰絕對不能放到前端：VITE_ 開頭的變數會被打包進 JS，任何人開 F12 就能拿走。
這裡沿用既有的 Firebase 服務帳號換取 OAuth token，因此不需要額外的 API key，
也不需要多裝 google-cloud-texttospeech（google-auth 已隨 firebase-admin 安裝）。
"""

import base64
import logging
import os
import threading
from collections import OrderedDict
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

SYNTHESIZE_URL = "https://texttospeech.googleapis.com/v1/text:synthesize"
SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]

# 災害指令的用字高度重複（「請立即趴下」等），快取可以省下延遲與免費額度。
CACHE_LIMIT = 64


class TTSError(Exception):
    """語音合成失敗。前端收到後會自動退回瀏覽器內建語音。"""


class TTSService:
    def __init__(self) -> None:
        self._credentials = None
        self._lock = threading.Lock()
        self._cache: "OrderedDict[tuple, bytes]" = OrderedDict()

    # ------------------------------------------------------------------
    def _service_account_path(self) -> Path | None:
        for env_name in (
            "GOOGLE_APPLICATION_CREDENTIALS",
            "FIREBASE_SERVICE_ACCOUNT_PATH",
        ):
            value = os.getenv(env_name)
            if value and Path(value).is_file():
                return Path(value)

        default = Path(__file__).resolve().parent.parent.parent / "firebase-service-account.json"
        return default if default.is_file() else None

    def _get_credentials(self):
        """服務帳號憑證。token 過期時 google-auth 會自己換新的。"""
        with self._lock:
            if self._credentials is None:
                try:
                    from google.oauth2 import service_account
                except ImportError as exc:  # pragma: no cover
                    raise TTSError("google-auth 未安裝") from exc

                path = self._service_account_path()
                if path is None:
                    raise TTSError("找不到 Google 服務帳號金鑰檔")

                self._credentials = service_account.Credentials.from_service_account_file(
                    str(path), scopes=SCOPES
                )
            return self._credentials

    def _access_token(self) -> str:
        from google.auth.transport.requests import Request

        credentials = self._get_credentials()
        with self._lock:
            if not credentials.valid:
                credentials.refresh(Request())
            return credentials.token

    # ------------------------------------------------------------------
    async def synthesize(
        self,
        text: str,
        voice: str | None = None,
        speaking_rate: float = 1.0,
    ) -> bytes:
        """把文字合成為 MP3 位元組。失敗時拋 TTSError。"""
        text = (text or "").strip()
        if not text:
            raise TTSError("沒有要朗讀的文字")
        if len(text) > 2000:
            # Google 單次上限是 5000 bytes；中文一個字約 3 bytes，這裡抓保守值。
            raise TTSError("文字過長")

        # Google 只接受 0.25～4.0；超出範圍會直接回 400，在這裡夾住比讓警報失效好。
        speaking_rate = min(4.0, max(0.25, float(speaking_rate or 1.0)))

        voice_name = voice or os.getenv("GOOGLE_TTS_VOICE", "cmn-TW-Wavenet-A")
        # 語音名稱的前兩段就是語言代碼，例如 cmn-TW-Wavenet-A -> cmn-TW。
        language_code = "-".join(voice_name.split("-")[:2])
        cache_key = (text, voice_name, round(speaking_rate, 2))

        cached = self._cache.get(cache_key)
        if cached is not None:
            self._cache.move_to_end(cache_key)
            return cached

        try:
            token = self._access_token()
        except TTSError:
            raise
        except Exception as exc:
            logger.exception("無法取得 Google TTS 存取權杖")
            raise TTSError("無法取得 Google 存取權杖") from exc

        payload = {
            "input": {"text": text},
            "voice": {"languageCode": language_code, "name": voice_name},
            "audioConfig": {"audioEncoding": "MP3", "speakingRate": speaking_rate},
        }

        try:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.post(
                    SYNTHESIZE_URL,
                    json=payload,
                    headers={"Authorization": f"Bearer {token}"},
                )
        except Exception as exc:
            logger.exception("呼叫 Google TTS 失敗")
            raise TTSError("無法連線至 Google 語音服務") from exc

        if response.status_code != 200:
            detail = response.text[:300]
            logger.error("Google TTS 回應 %s：%s", response.status_code, detail)
            if response.status_code in (401, 403):
                raise TTSError(
                    "Google 語音服務未授權。請確認 Cloud Text-to-Speech API 已啟用、"
                    "且該專案已開啟計費。"
                )
            raise TTSError(f"Google 語音服務錯誤（{response.status_code}）")

        audio_b64 = response.json().get("audioContent")
        if not audio_b64:
            raise TTSError("Google 語音服務沒有回傳音訊")

        audio = base64.b64decode(audio_b64)

        self._cache[cache_key] = audio
        self._cache.move_to_end(cache_key)
        while len(self._cache) > CACHE_LIMIT:
            self._cache.popitem(last=False)

        return audio


tts_service = TTSService()
