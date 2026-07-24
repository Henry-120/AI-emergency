/**
 * GuardiaAI 藍牙模組 - 統一對外 API（Facade）
 *
 * UI 元件應**只 import 此檔或 bluetoothInbox**，不直接 import central / peripheral，
 * 這樣未來底層實作改動（例如換套件、改 Swift 介面）不會影響 UI 層。
 *
 * 提供：
 *   - initBluetooth        ：準備藍牙堆疊
 *   - startBroadcasting    ：開始讓附近的人看見自己
 *   - stopBroadcasting     ：停止
 *   - getStatus            ：目前狀態（給 UI 顯示提示）
 *   - scanNearby           ：尋找附近的人（可取消、可即時串流結果）
 *   - stopScan             ：中止目前的掃描
 *   - sendMessage          ：傳訊息給某個附近的人
 *   - subscribeMessages    ：訂閱收訊事件（一般 UI 不用，改用 bluetoothInbox）
 *   - getLocalId           ：本機識別碼（持久化，重開 App 不變）
 */

import {
  canAdvertise,
  getIsAdvertising,
  onMessageReceived,
  onSosPacketReceived,
  startAdvertising,
  stopAdvertising,
} from "./bluetoothPeripheral";
import {
  disconnectAll,
  ensureInitialized,
  isBluetoothEnabled,
  isScanning,
  scanNearby as centralScan,
  sendMessageTo,
  sendSosPacket,
  stopScan as centralStopScan,
  type ScanOptions,
} from "./bluetoothCentral";
import { getOrCreateLocalId } from "./bluetoothIdentity";
import type {
  BluetoothStatus,
  ChatRecord,
  IncomingMessage,
  MessageKind,
  NearbyDevice,
  OutgoingMessage,
} from "./bluetoothTypes";

/** Re-export 型別供 UI 直接使用 */
export type {
  BluetoothStatus,
  ChatRecord,
  IncomingMessage,
  MessageKind,
  NearbyDevice,
  OutgoingMessage,
  ScanOptions,
};

/**
 * 初始化藍牙堆疊。
 *
 * 只喚醒 BleClient（要權限）與確認開關狀態，不會自動開始廣播或掃描。
 */
export async function initBluetooth(): Promise<void> {
  await ensureInitialized();
}

/** 取得目前藍牙整體狀態，給 UI 顯示提示用 */
export async function getStatus(): Promise<BluetoothStatus> {
  const isNative = canAdvertise();
  const isEnabled = await isBluetoothEnabled();
  const isAdvertising = await getIsAdvertising();
  return {
    isNative,
    isEnabled,
    isAdvertising,
    isScanning: isScanning(),
  };
}

/**
 * 開始廣播自己。
 *
 * 使用持久化的本機識別碼——重開 App 後仍是同一組，對方才認得出你是同一個人，
 * 既有的對話歷史也才對得起來。
 */
export async function startBroadcasting(): Promise<{ localId: string; success: boolean }> {
  const localId = getOrCreateLocalId();
  const success = await startAdvertising(localId);
  return { localId, success };
}

/** 停止廣播自己 */
export async function stopBroadcasting(): Promise<void> {
  await stopAdvertising();
}

/** 本機識別碼（持久化；重開 App 不會變） */
export function getLocalId(): string {
  return getOrCreateLocalId();
}

/**
 * 尋找附近的人。
 *
 * 可透過 options.signal 取消，並以 options.onDevice 即時取得每一台掃到的裝置
 * （不必等整輪結束）。
 */
export async function scanNearby(options: ScanOptions): Promise<NearbyDevice[]> {
  return centralScan(options);
}

/** 中止目前的掃描 */
export function stopScan(): void {
  centralStopScan();
}

/** 斷開所有藍牙連線（離開藍牙功能時呼叫） */
export async function disconnectAllPeers(): Promise<void> {
  await disconnectAll();
}

/**
 * 傳訊息給附近某裝置（必須是同 App 用戶）。
 *
 * 長訊息會自動分片；連線會保留一小段時間供後續訊息複用。
 *
 * @returns 成功時附上實際送出的訊息物件，供呼叫端寫入對話紀錄
 */
export async function sendMessage(
  deviceId: string,
  text: string,
  location?: { lat: number; lng: number },
  kind: MessageKind = "chat",
): Promise<{ success: boolean; error?: string; message?: OutgoingMessage }> {
  const message: OutgoingMessage = {
    from: getOrCreateLocalId(),
    text,
    kind,
    location,
    timestamp: Date.now(),
  };

  const result = await sendMessageTo(deviceId, message);
  return result.success ? { ...result, message } : result;
}

/**
 * 訂閱「收到訊息」事件。
 *
 * 一般 UI 不應直接使用——請改用 bluetoothInbox，它會常駐收訊並持久化。
 * 這個函式是給 bluetoothInbox 自己用的。
 */
export async function subscribeMessages(
  handler: (msg: IncomingMessage) => void,
): Promise<() => void> {
  return onMessageReceived(handler);
}

/**
 * 傳一個 SOS 中繼封包給附近某裝置。給 sosRelay 引擎使用，一般 UI 不需要。
 */
export async function sendSos(
  deviceId: string,
  packetBytes: Uint8Array,
): Promise<{ success: boolean; error?: string }> {
  return sendSosPacket(deviceId, packetBytes);
}

/**
 * 訂閱「收到 SOS 中繼封包」事件。給 sosRelay 引擎使用，一般 UI 不需要。
 */
export async function subscribeSosPackets(
  handler: (packetBytes: Uint8Array, centralId: string) => void,
): Promise<() => void> {
  return onSosPacketReceived(handler);
}

/**
 * 強震發生時自動發出的「存活訊號」。
 *
 * 由 App.tsx 的地震警報邏輯觸發：掃描附近的同 App 使用者，對每一位送出一則
 * 帶位置的訊號。對方會在「附近的人」的對話中收到，得知你在附近、需要留意。
 *
 * 取代 main 原本建在殘缺舊 BLE 上的同名函式——舊版的 startGuardianAdvertising
 * 直接 throw，手機無法對外廣播，兩機互相掃不到，這個自動訊號其實發不出去。
 * 本版改用能真正運作的模組（可廣播、分片、驗證）。
 *
 * 註：這裡送的是明文的近距離訊號，用於「讓附近的人知道我在」。真正要把求救
 * 傳到外界（多跳中繼 + 加密）是 src/services/sos 的職責，需後端金鑰後才啟用。
 *
 * @param location 目前位置（可選，會附在訊號中）
 * @param scanMs   掃描附近的時間
 * @returns discovered = 掃到的同 App 人數；sent = 成功送達的則數
 */
export async function sendAutomaticSurvivalSignal(
  location?: { lat: number; lng: number },
  scanMs = 5000,
): Promise<{ discovered: number; sent: number }> {
  await initBluetooth();

  const devices = await scanNearby({
    onlyGuardiaUsers: true,
    durationMs: scanMs,
  });

  // 只發給能識別身分的同 App 使用者（對方需在前景廣播其 localId）
  const targets = devices.filter((d) => d.isGuardiaUser && d.localId);

  let sent = 0;
  for (const target of targets) {
    const res = await sendMessage(
      target.deviceId,
      "我在強震影響範圍內，透過藍牙自動通知附近的人。",
      location,
      "survival", // 標記為存活訊號 → 收方會醒目顯示成求救提示，而非普通聊天
    );
    if (res.success) sent += 1;
  }

  return { discovered: targets.length, sent };
}
