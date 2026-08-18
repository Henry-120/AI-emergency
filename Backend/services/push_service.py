import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone

from firebase_admin import messaging

from .cwa_service import CWAService
from .firebase_service import firebase_service

logger = logging.getLogger(__name__)

# 與前端 src/services/cwaService.ts 的 SEVERE_EARTHQUAKE_MAGNITUDE 保持一致。
SEVERE_EARTHQUAKE_MAGNITUDE = 5.0
POLL_INTERVAL_SECONDS = 60

# 只推播剛發生的地震。CWA 回傳的永遠是「最新一筆」，可能是好幾天前的；
# 少了這道檢查，在乾淨的 push_state 上啟動後端就會為一場舊地震發出強震警報。
# 代價是後端停機超過這個時間才復原時會漏推，寧可漏推也不要誤報。
MAX_ALERT_AGE_SECONDS = 30 * 60
TAIPEI_TZ = timezone(timedelta(hours=8))

# 測試用推播：追蹤「現在天氣觀測報告」某測站氣溫變化，每 10 分鐘更新一次，
# 遠比地震頻繁，純粹用來驗證推播路徑（App 關閉時能否收到、點擊能否開啟），
# 跟正式的強震警示邏輯完全分開。用 ENABLE_TEST_PUSH=true 開啟。
TEST_PUSH_STATION_ID = os.getenv("TEST_PUSH_STATION_ID", "466920")


def _alert_key(alert: dict) -> str:
    return f"{alert.get('time')}-{alert.get('magnitude')}-{alert.get('location')}"


def _clean_location(location) -> str:
    """CWA 的地點字串夾雜多餘空白（如「宜蘭縣政府東南東方  52.8  公里」），推播上會很醜。"""
    return " ".join(str(location or "").split())


def _is_recent(alert: dict) -> bool:
    raw_time = alert.get("time")
    if not raw_time:
        return False
    try:
        occurred = datetime.fromisoformat(str(raw_time))
    except ValueError:
        logger.warning("無法解析地震時間，略過推播：%s", raw_time)
        return False
    if occurred.tzinfo is None:
        # CWA 未帶時區時回的是台北時間 (UTC+8)。
        occurred = occurred.replace(tzinfo=TAIPEI_TZ)
    return (datetime.now(timezone.utc) - occurred).total_seconds() <= MAX_ALERT_AGE_SECONDS


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
    depth = alert.get("depth")
    depth_text = f"，深度 {float(depth):.0f} 公里" if depth is not None else ""
    location = _clean_location(alert.get("location"))
    _send_push(
        # App 名稱由 iOS 自己顯示在橫幅上，標題不再重複 GuardiaAI，改放最關鍵的規模。
        title=f"⚠️ 強震警報｜規模 {float(alert['magnitude']):.1f}",
        body=f"{location}{depth_text}。請立即趴下、掩護、穩住，點開聽避難語音指示。",
        data={
            "type": "earthquake",
            "magnitude": str(alert.get("magnitude") or ""),
            "location": location,
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
            if (
                not alert.get("error")
                and float(alert.get("magnitude") or 0) >= SEVERE_EARTHQUAKE_MAGNITUDE
                and _is_recent(alert)
            ):
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
