/**
 * GuardiaAI 藍牙模組 - Peripheral 端（廣播自己 + 接收訊息）
 *
 * 這檔案是「我們自己寫的 Swift 插件」（ios/App/App/BluetoothPeripheral/）
 * 的 JS 端對應封裝。
 *
 * 只在 iOS 原生 App 內可用；在瀏覽器中所有方法會回傳「不支援」並靜默忽略。
 *
 * 收訊流程（每一步都可能失敗，失敗一律丟棄，絕不讓壞資料進入 UI）：
 *
 *   Swift 收到 GATT write
 *     → base64 字串推給 JS
 *     → 解 base64 得原始 bytes
 *     → parseFrame 解析分片標頭
 *     → FrameReassembler 收齊所有分片
 *     → UTF-8 解碼成 JSON 字串
 *     → parseIncomingMessage 驗證欄位
 *     → 交給 handler
 */

import { registerPlugin, Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { FrameReassembler, parseFrame } from "./bluetoothChunking";
import { parseIncomingMessage } from "./bluetoothValidation";
import type { IncomingMessage } from "./bluetoothTypes";

// ----- 原生插件介面（對應 BlePeripheralPlugin.swift 的 @objc 方法） -----
interface BlePeripheralPlugin {
  startAdvertising(options: { localId: string }): Promise<{ success: boolean; localId: string }>;
  stopAdvertising(): Promise<{ success: boolean }>;
  isAdvertising(): Promise<{ isAdvertising: boolean }>;
  addListener(
    eventName: "messageReceived",
    listener: (event: { data: string; centralId: string; timestamp: number }) => void,
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
 * @param localId 廣播時附帶的短識別字串
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

/** base64 → 原始 bytes */
function base64ToBytes(base64: string): Uint8Array | null {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null; // 不是合法 base64
  }
}

/**
 * 註冊「收到訊息」的監聽器。
 *
 * 訊息來源是附近的 Central（別人的手機）透過 GATT write 寫入。**來源不可信**，
 * 因此每一層都做檢查，任何一步不合法就丟棄，不讓格式錯誤的資料進到畫面。
 *
 * @returns unregister function；不再需要時務必呼叫，避免 listener 累積
 */
export async function onMessageReceived(
  handler: (msg: IncomingMessage) => void,
): Promise<() => void> {
  if (!canAdvertise()) {
    return () => {};
  }

  // 每個監聽器有自己的重組器，避免不同訂閱者互相污染分片狀態
  const reassembler = new FrameReassembler();
  const decoder = new TextDecoder();

  const listener = await BlePeripheral.addListener("messageReceived", (event) => {
    const bytes = base64ToBytes(event.data);
    if (!bytes) {
      console.warn("[BLE] 收到無法解碼的 base64，已丟棄");
      return;
    }

    const frame = parseFrame(bytes);
    if (!frame) {
      console.warn("[BLE] 收到格式錯誤的分片，已丟棄");
      return;
    }

    // 依來源分組重組；尚未收齊時回傳 null，靜靜等下一片
    const complete = reassembler.add(event.centralId, frame);
    if (!complete) return;

    // 分片全數到齊後才做 UTF-8 解碼——中途解碼會在多位元組字元的切點出錯
    let json: string;
    try {
      json = decoder.decode(complete);
    } catch {
      console.warn("[BLE] 重組後的資料不是合法 UTF-8，已丟棄");
      return;
    }

    const message = parseIncomingMessage(json);
    if (!message) {
      console.warn("[BLE] 收到欄位不合法的訊息，已丟棄");
      return;
    }

    handler({ ...message, centralId: event.centralId });
  });

  return () => {
    listener.remove();
  };
}
