import { Capacitor } from "@capacitor/core";
import { FirebaseMessaging } from "@capacitor-firebase/messaging";
import { BACKEND } from "./backend";
import { getBackendToken } from "./authService";
import type { EarthquakeAlert } from "./cwaService";

let pushTapHandler: ((alert?: EarthquakeAlert) => void) | null = null;
let listenersReady = false;

async function postToken(token: string) {
  try {
    const backendToken = getBackendToken();
    await fetch(`${BACKEND}/api/push/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(backendToken ? { Authorization: `Bearer ${backendToken}` } : {}),
      },
      body: JSON.stringify({ token, platform: "ios" }),
    });
  } catch (e) {
    console.warn("無法註冊推播 token", e);
  }
}

export function onPushEarthquakeNotificationTapped(handler: (alert?: EarthquakeAlert) => void) {
  pushTapHandler = handler;
  return () => {
    if (pushTapHandler === handler) pushTapHandler = null;
  };
}

export async function initPushNotifications() {
  if (!Capacitor.isNativePlatform()) return;

  const permission = await FirebaseMessaging.requestPermissions();
  if (permission.receive !== "granted") return;

  if (!listenersReady) {
    listenersReady = true;
    await FirebaseMessaging.addListener("tokenReceived", (event) => {
      void postToken(event.token);
    });
    await FirebaseMessaging.addListener("notificationActionPerformed", (event) => {
      const data = event.notification.data as Record<string, unknown> | undefined;
      if (data?.type !== "earthquake") return;
      // 推播可能在使用者斷網後才被點開；直接使用 FCM 已附帶的震央資料，
      // 不必依賴重新向後端抓 CWA 才能啟動離線安全確認。
      const asNumber = (value: unknown) => {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
      };
      const magnitude = asNumber(data.magnitude);
      pushTapHandler?.(magnitude == null ? undefined : {
        magnitude,
        location: String(data.location || "未知位置"),
        time: String(data.time || ""),
        depth: asNumber(data.depth) ?? undefined,
        epicenterLat: asNumber(data.epicenterLat),
        epicenterLng: asNumber(data.epicenterLng),
      });
    });
  }

  const { token } = await FirebaseMessaging.getToken();
  if (token) await postToken(token);
}
