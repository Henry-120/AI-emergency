import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import type { EarthquakeAlert } from "./cwaService";

const EARTHQUAKE_NOTIFICATION_ID = 81001;

/** 通知送出的結果。失敗時帶原因，讓畫面能告訴使用者為什麼沒跳通知。 */
export interface EarthquakeNotifyResult {
  shown: boolean;
  reason?: "unsupported" | "denied";
}

let tapHandler: (() => void) | null = null;
let listenersReady = false;

async function ensureNativeListeners() {
  if (!Capacitor.isNativePlatform() || listenersReady) return;
  listenersReady = true;
  await LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
    if (event.notification.id === EARTHQUAKE_NOTIFICATION_ID) tapHandler?.();
  });
}

export async function onEarthquakeNotificationTapped(handler: () => void) {
  tapHandler = handler;
  await ensureNativeListeners();
  return () => {
    if (tapHandler === handler) tapHandler = null;
  };
}

export async function notifyEarthquakeAlert(
  alert: EarthquakeAlert,
): Promise<EarthquakeNotifyResult> {
  // 文字需與後端推播 Backend/services/push_service.py 的 send_earthquake_push 保持一致。
  const location = alert.location.replace(/\s+/g, " ").trim();
  const depthText = alert.depth != null ? `，深度 ${Math.round(alert.depth)} 公里` : "";
  const title = `⚠️ 強震警報｜規模 ${alert.magnitude.toFixed(1)}`;
  const body = `${location}${depthText}。請立即趴下、掩護、穩住，點開聽避難語音指示。`;
  if (Capacitor.isNativePlatform()) {
    await ensureNativeListeners();
    const permission = await LocalNotifications.requestPermissions();
    if (permission.display !== "granted") return { shown: false, reason: "denied" };
    await LocalNotifications.schedule({
      notifications: [{
        id: EARTHQUAKE_NOTIFICATION_ID,
        title,
        body,
        schedule: { at: new Date(Date.now() + 100) },
        extra: { type: "earthquake" },
      }],
    });
    return { shown: true };
  }
  if (!("Notification" in window)) return { shown: false, reason: "unsupported" };
  const permission = Notification.permission === "default"
    ? await Notification.requestPermission()
    : Notification.permission;
  if (permission !== "granted") return { shown: false, reason: "denied" };
  const notification = new Notification(title, { body, tag: "guardia-earthquake" });
  notification.onclick = () => {
    window.focus();
    tapHandler?.();
    notification.close();
  };
  return { shown: true };
}
