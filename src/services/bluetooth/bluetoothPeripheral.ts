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
import { PACKET_KIND_CHAT, PACKET_KIND_SOS } from "./bluetoothConstants";
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
export async function startAdvertising(
  localId: string,
): Promise<{ success: boolean; error?: string }> {
  if (!canAdvertise()) {
    console.warn("[BLE] 非原生環境，無法廣播");
    return { success: false, error: "此功能需要在手機 App 中使用" };
  }
  try {
    const res = await BlePeripheral.startAdvertising({ localId });
    return { success: res.success };
  } catch (err) {
    // 錯誤訊息一路帶回 UI：原生層失敗的原因（權限被拒、藍牙關閉、plugin 未註冊…）
    // 各不相同，全部收斂成同一句通用訊息會讓問題完全無法診斷。
    const message = err instanceof Error ? err.message : String(err);
    console.error("[BLE] startAdvertising 失敗", err);
    return { success: false, error: message };
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
 * 收到一則完整重組後的訊息時，依第一個 byte（訊息種類）分流。
 *
 * 聊天與 SOS 共用同一條 characteristic，靠這個 tag byte 區分——見
 * bluetoothConstants.ts 的 PACKET_KIND_CHAT / PACKET_KIND_SOS 說明。
 */
type RawMessageHandler = (kind: number, body: Uint8Array, centralId: string) => void;

/**
 * 註冊底層的原生收訊監聽器：base64 解碼 → 分片解析 → 依來源重組。
 *
 * 每個呼叫端各自擁有獨立的 FrameReassembler，彼此重組狀態不互相污染；
 * 代價是同一個原生事件會被每個訂閱者各自重組一次，但求救/心跳事件頻率低，
 * 換取的是聊天與 SOS 兩條邏輯完全不需要共用狀態、互不干擾。
 */
async function subscribeRawMessages(onComplete: RawMessageHandler): Promise<() => void> {
  const reassembler = new FrameReassembler();

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
    if (!complete || complete.byteLength === 0) return;

    onComplete(complete[0], complete.subarray(1), event.centralId);
  });

  return () => {
    listener.remove();
  };
}

/**
 * 註冊「收到聊天訊息」的監聽器（「附近的人」用）。
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

  const decoder = new TextDecoder();

  return subscribeRawMessages((kind, body, centralId) => {
    if (kind !== PACKET_KIND_CHAT) return; // 不是聊天訊息（例如 SOS 封包），不歸這裡管

    // 分片全數到齊後才做 UTF-8 解碼——中途解碼會在多位元組字元的切點出錯
    let json: string;
    try {
      json = decoder.decode(body);
    } catch {
      console.warn("[BLE] 重組後的資料不是合法 UTF-8，已丟棄");
      return;
    }

    const message = parseIncomingMessage(json);
    if (!message) {
      console.warn("[BLE] 收到欄位不合法的訊息，已丟棄");
      return;
    }

    handler({ ...message, centralId });
  });
}

/**
 * 註冊「收到 SOS 中繼封包」的監聽器。
 *
 * 只交出原始 bytes（已編碼、已加密），不在這一層解析——封包標頭解析與內容
 * 解密是 sosProtocol / sosCrypto 的職責，這裡只負責「這是一包 SOS 流量」的判斷。
 *
 * @returns unregister function
 */
export async function onSosPacketReceived(
  handler: (packetBytes: Uint8Array, centralId: string) => void,
): Promise<() => void> {
  if (!canAdvertise()) {
    return () => {};
  }

  return subscribeRawMessages((kind, body, centralId) => {
    if (kind !== PACKET_KIND_SOS) return; // 不是 SOS 封包（例如聊天訊息），不歸這裡管
    handler(body, centralId);
  });
}
