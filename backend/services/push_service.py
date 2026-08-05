import asyncio
import logging
import os

from firebase_admin import messaging

from .cwa_service import CWAService
from .firebase_service import firebase_service

logger = logging.getLogger(__name__)

# 與前端 src/services/cwaService.ts 的 SEVERE_EARTHQUAKE_MAGNITUDE 保持一致。
SEVERE_EARTHQUAKE_MAGNITUDE = 5.0
POLL_INTERVAL_SECONDS = 60

# 測試用推播：追蹤「現在天氣觀測報告」某測站氣溫變化，每 10 分鐘更新一次，
# 遠比地震頻繁，純粹用來驗證推播路徑（App 關閉時能否收到、點擊能否開啟），
# 跟正式的強震警示邏輯完全分開。用 ENABLE_TEST_PUSH=true 開啟。
TEST_PUSH_STATION_ID = os.getenv("TEST_PUSH_STATION_ID", "466920")


def _alert_key(alert: dict) -> str:
    return f"{alert.get('time')}-{alert.get('magnitude')}-{alert.get('location')}"


def _send_push(title: str, body: str, data: dict) -> None:
    tokens = firebase_service.list_device_tokens()
    if not tokens:
        return

    message = messaging.MulticastMessage(
        notification=messaging.Notification(title=title, body=body),
        data=data,
        apns=messaging.APNSConfig(
            payload=messaging.APNSPayload(
                aps=messaging.Aps(sound="default", content_available=True)
            )
        ),
        tokens=tokens,
    )

    response = messaging.send_each_for_multicast(message)
    invalid_tokens = [
        tokens[i]
        for i, result in enumerate(response.responses)
        if not result.success and isinstance(result.exception, messaging.UnregisteredError)
    ]
    if invalid_tokens:
        firebase_service.remove_device_tokens(invalid_tokens)

    logger.info(
        "FCM push sent (%s): %d success, %d failure",
        data.get("type"),
        response.success_count,
        response.failure_count,
    )


def send_earthquake_push(alert: dict) -> None:
    _send_push(
        title="⚠️ GuardiaAI 強震警報",
        body=f"規模 {float(alert['magnitude']):.1f}，{alert['location']}。點擊查看避難語音指示。",
        data={
            "type": "earthquake",
            "magnitude": str(alert.get("magnitude") or ""),
            "location": str(alert.get("location") or ""),
            "time": str(alert.get("time") or ""),
            "depth": str(alert.get("depth") or ""),
            "epicenterLat": str(alert.get("epicenterLat") or ""),
            "epicenterLng": str(alert.get("epicenterLng") or ""),
        },
    )


def send_test_push(observation: dict) -> None:
    _send_push(
        title="🧪 GuardiaAI 測試通知",
        body=f"{observation.get('stationName')} 測站氣溫 {observation.get('temperature')}°C（{observation.get('obsTime')}）",
        data={
            "type": "test",
            "stationId": str(observation.get("stationId") or ""),
            "stationName": str(observation.get("stationName") or ""),
            "temperature": str(observation.get("temperature") or ""),
            "obsTime": str(observation.get("obsTime") or ""),
        },
    )


async def poll_and_push_loop(cwa: CWAService) -> None:
    """定期輪詢 CWA，偵測到新的強震就推播給所有已註冊裝置。"""
    while True:
        try:
            alert = await cwa.get_latest_alert()
            if not alert.get("error") and float(alert.get("magnitude") or 0) >= SEVERE_EARTHQUAKE_MAGNITUDE:
                key = _alert_key(alert)
                if firebase_service.get_last_notified_alert_key() != key:
                    # 先寫入 key 再送推播：寧可因送失敗漏推，也不要重啟/重試時重複轟炸使用者。
                    firebase_service.set_last_notified_alert_key(key)
                    send_earthquake_push(alert)
        except Exception:
            logger.exception("push poll iteration failed")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def test_poll_and_push_loop(cwa: CWAService) -> None:
    """測試專用：氣溫一有變化就推播，用來驗證推播路徑，不受地震門檻限制。"""
    while True:
        try:
            observation = await cwa.get_current_weather_observation(TEST_PUSH_STATION_ID)
            if not observation.get("error") and observation.get("temperature") is not None:
                key = f"{observation.get('stationId')}-{observation.get('obsTime')}-{observation.get('temperature')}"
                if firebase_service.get_last_test_push_key() != key:
                    firebase_service.set_last_test_push_key(key)
                    send_test_push(observation)
        except Exception:
            logger.exception("test push poll iteration failed")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
