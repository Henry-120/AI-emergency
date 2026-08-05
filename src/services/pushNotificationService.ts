import { Capacitor } from "@capacitor/core";
import { FirebaseMessaging } from "@capacitor-firebase/messaging";
import { BACKEND } from "./backend";
import { getBackendToken } from "./authService";

let pushTapHandler: (() => void) | null = null;
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

export function onPushEarthquakeNotificationTapped(handler: () => void) {
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
      if (data?.type === "earthquake") pushTapHandler?.();
    });
  }

  const { token } = await FirebaseMessaging.getToken();
  if (token) await postToken(token);
}
