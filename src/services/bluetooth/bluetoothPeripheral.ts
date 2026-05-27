/**
 * GuardiaAI 藍牙模組 - Peripheral 端（廣播自己 + 接收訊息）
 *
 * 這檔案是「我們自己寫的 Swift 插件」（ios/App/App/BluetoothPeripheral/）
 * 的 JS 端對應封裝。
 *
 * 只在 iOS 原生 App 內可用；在瀏覽器中所有方法會回傳「不支援」並靜默忽略。
 */

import { registerPlugin, Capacitor, type PluginListenerHandle } from "@capacitor/core";
import type { IncomingMessage } from "./bluetoothTypes";

// ----- 原生插件介面（對應 BlePeripheralPlugin.swift 的 @objc 方法） -----
interface BlePeripheralPlugin {
  startAdvertising(options: { localId: string }): Promise<{ success: boolean; localId: string }>;
  stopAdvertising(): Promise<{ success: boolean }>;
  isAdvertising(): Promise<{ isAdvertising: boolean }>;
  addListener(
    eventName: "messageReceived",
    listener: (event: { message: string; centralId: string; timestamp: number }) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

// 透過 Capacitor 取得原生插件實例
// （Capacitor 會在 native 環境自動連到我們的 Swift；在 web 環境會給空殼）
const BlePeripheral = registerPlugin<BlePeripheralPlugin>("BlePeripheral");

/**
 * 是否處於可廣播的環境。
 * 目前 Peripheral 端原生實作僅有 iOS（ios/App/App/BluetoothPeripheral/）；
 * Android 上即使 isNativePlatform 為 true，呼叫此 plugin 也會失敗，故額外擋掉。
 */
export function canAdvertise(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

/**
 * 開始廣播自己為 GuardiaAI 使用者
 * @param localId 廣播時附帶的短識別字串（建議 4–8 字元，避免廣播封包過長）
 */
export async function startAdvertising(localId: string): Promise<boolean> {
  if (!canAdvertise()) {
    console.warn("[BLE] 非原生環境，無法廣播");
    return false;
  }
  try {
    const res = await BlePeripheral.startAdvertising({ localId });
    return res.success;
  } catch (err) {
    console.error("[BLE] startAdvertising 失敗", err);
    return false;
  }
}

/** 停止廣播 */
export async function stopAdvertising(): Promise<void> {
  if (!canAdvertise()) return;
  try {
    await BlePeripheral.stopAdvertising();
  } catch (err) {
    console.error("[BLE] stopAdvertising 失敗", err);
  }
}

/** 查詢目前是否正在廣播（給 UI 顯示開關狀態用） */
export async function getIsAdvertising(): Promise<boolean> {
  if (!canAdvertise()) return false;
  try {
    const res = await BlePeripheral.isAdvertising();
    return res.isAdvertising;
  } catch {
    return false;
  }
}

/**
 * 註冊「收到訊息」的監聽器
 *
 * 訊息來源：附近的 Central（通常是別人的手機）透過 GATT write 寫進來，
 * 由 Swift 端 BlePeripheralManager 收到後透過 Capacitor event 推上來。
 *
 * @returns unregister function；元件 unmount 時務必呼叫，避免 memory leak
 */
export async function onMessageReceived(
  handler: (msg: IncomingMessage) => void,
): Promise<() => void> {
  if (!canAdvertise()) {
    return () => {};
  }

  const listener = await BlePeripheral.addListener("messageReceived", (event) => {
    // Swift 端把 bytes 轉成 UTF-8 字串後傳上來；我們約定 JS 端發送時
    // 會把 OutgoingMessage 物件 JSON.stringify，所以這裡反向 parse。
    try {
      const parsed = JSON.parse(event.message);
      handler({
        ...parsed,
        centralId: event.centralId,
      });
    } catch (err) {
      console.error("[BLE] 收到無法解析的訊息", event.message, err);
    }
  });

  return () => {
    listener.remove();
  };
}
