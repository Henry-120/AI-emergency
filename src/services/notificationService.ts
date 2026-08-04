import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import type { EarthquakeAlert } from "./cwaService";

<<<<<<< HEAD
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
=======
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    // Capacitor native
    if (Capacitor.isNativePlatform && Capacitor.isNativePlatform()) {
      const perm = await LocalNotifications.requestPermissions();
      return (perm as any).receive === "granted" || perm.display === "granted";
    }

    // Browser
    if ("Notification" in window) {
      const status = Notification.permission;
      if (status === "granted") return true;
      if (status === "denied") return false;
      const result = await Notification.requestPermission();
      return result === "granted";
    }
  } catch (e) {
    console.warn("notification permission request failed", e);
  }
  return false;
}

export async function notifyEarthquake(alert: EarthquakeAlert) {
  const title = `地震警報：${alert.location} ${alert.magnitude.toFixed(1)}級`;
  const body = alert.description || "請立即打開 GuardiaAI 取得指引。";

  try {
    if (Capacitor.isNativePlatform && Capacitor.isNativePlatform()) {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: Date.now(),
            title,
            body,
            schedule: { at: new Date(Date.now() + 100) },
            extra: { tag: "earthquake", alert },
            smallIcon: "res://ic_stat_notify",
          },
        ],
      });
      return;
    }

    if ("Notification" in window && Notification.permission === "granted") {
      const n = new Notification(title, {
        body,
        tag: "earthquake",
        renotify: true,
      });

      n.onclick = function (ev) {
        ev.preventDefault();
        try {
          window.focus();
          // Optionally navigate or show UI in app
        } catch (e) {}
        this.close();
      };
      return;
    }
  } catch (e) {
    console.warn("notifyEarthquake failed", e);
  }
}

export function initNotificationListeners(onNotificationClick?: (payload: any) => void) {
  try {
    if (Capacitor.isNativePlatform && Capacitor.isNativePlatform()) {
      LocalNotifications.addListener(
        "localNotificationActionPerformed",
        (notification) => {
          try {
            const extra = (notification as any)?.notification?.extra;
            onNotificationClick?.(extra);
          } catch (e) {
            onNotificationClick?.(null);
          }
        },
      );
    }
  } catch (e) {
    console.warn("initNotificationListeners failed", e);
  }
>>>>>>> 58fdbf595c177e942c8e1e94f609c964f5121f17
}
