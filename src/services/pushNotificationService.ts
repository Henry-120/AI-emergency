import { Capacitor } from "@capacitor/core";
import { FirebaseMessaging } from "@capacitor-firebase/messaging";
import { BACKEND } from "./backend";
import { getBackendToken } from "./authService";

export interface EarthquakeDrill {
  type: "earthquake_drill";
  id: string;
  time: string;
  title: string;
  body: string;
}
let drillHandler: ((drill: EarthquakeDrill) => void) | null = null;
export function onEarthquakeDrill(handler: (drill: EarthquakeDrill) => void) {
  drillHandler = handler;
  return () => { if (drillHandler === handler) drillHandler = null; };
}
function receiveDrill(data: unknown) {
  const drill = data as EarthquakeDrill | undefined;
  if (drill?.type === "earthquake_drill" && typeof drill.id === "string"
    && typeof drill.title === "string" && typeof drill.body === "string") drillHandler?.(drill);
}
export async function canBroadcastDrill(): Promise<boolean> {
  const token = getBackendToken();
  if (!token) return false;
  try {
    const response = await fetch(`${BACKEND}/api/earthquake/drill/permission`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.ok;
  } catch { return false; }
}
export async function broadcastDrill(): Promise<{ drill: EarthquakeDrill; success: number; failure: number; errors?: Record<string, number> }> {
  const token = getBackendToken();
  if (!token) throw new Error("請先線上登入郭碩宏帳號");
  const response = await fetch(`${BACKEND}/api/earthquake/drill`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || "演練推播失敗");
  return data;
}

let pushTapHandler: (() => void) | null = null;
let listenersReady = false;

async function postToken(token: string) {
  try {
    const backendToken = getBackendToken();
    const response = await fetch(`${BACKEND}/api/push/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(backendToken ? { Authorization: `Bearer ${backendToken}` } : {}),
      },
      body: JSON.stringify({ token, platform: "ios" }),
    });
    if (!response.ok) throw new Error(`推播註冊失敗（HTTP ${response.status}）`);
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
    await FirebaseMessaging.addListener("notificationReceived", (event) => {
      receiveDrill(event.notification.data);
    });
    await FirebaseMessaging.addListener("notificationActionPerformed", (event) => {
      receiveDrill(event.notification.data);
      const data = event.notification.data as Record<string, unknown> | undefined;
      if (data?.type === "earthquake") pushTapHandler?.();
    });
  }

  const { token } = await FirebaseMessaging.getToken();
  if (token) await postToken(token);
}
