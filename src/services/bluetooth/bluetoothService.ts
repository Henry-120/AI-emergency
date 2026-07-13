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
  stopScan as centralStopScan,
  type ScanOptions,
} from "./bluetoothCentral";
import { getOrCreateLocalId } from "./bluetoothIdentity";
import type {
  BluetoothStatus,
  ChatRecord,
  IncomingMessage,
  NearbyDevice,
  OutgoingMessage,
} from "./bluetoothTypes";

/** Re-export 型別供 UI 直接使用 */
export type {
  BluetoothStatus,
  ChatRecord,
  IncomingMessage,
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
): Promise<{ success: boolean; error?: string; message?: OutgoingMessage }> {
  const message: OutgoingMessage = {
    from: getOrCreateLocalId(),
    text,
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
