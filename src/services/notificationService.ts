import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import type { EarthquakeAlert } from "./cwaService";

const EARTHQUAKE_NOTIFICATION_ID = 81001;
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

export async function notifyEarthquakeAlert(alert: EarthquakeAlert) {
  const body = `規模 ${alert.magnitude.toFixed(1)}，${alert.location}。點擊查看避難語音指示。`;
  if (Capacitor.isNativePlatform()) {
    await ensureNativeListeners();
    const permission = await LocalNotifications.requestPermissions();
    if (permission.display !== "granted") return false;
    await LocalNotifications.schedule({
      notifications: [{
        id: EARTHQUAKE_NOTIFICATION_ID,
        title: "⚠️ GuardiaAI 強震警報",
        body,
        schedule: { at: new Date(Date.now() + 100) },
        extra: { type: "earthquake" },
      }],
    });
    return true;
  }
  if (!("Notification" in window)) return false;
  const permission = Notification.permission === "default"
    ? await Notification.requestPermission()
    : Notification.permission;
  if (permission !== "granted") return false;
  const notification = new Notification("⚠️ GuardiaAI 強震警報", { body, tag: "guardia-earthquake" });
  notification.onclick = () => {
    window.focus();
    tapHandler?.();
    notification.close();
  };
  return true;
}
