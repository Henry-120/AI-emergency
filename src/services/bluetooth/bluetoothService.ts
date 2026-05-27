/**
 * GuardiaAI 藍牙模組 - 統一對外 API（Facade）
 *
 * UI 元件（如 NearbyPeoplePage）應**只 import 此檔**，不直接 import central / peripheral，
 * 這樣未來底層實作改動（例如換套件、改 Swift 介面）不會影響 UI 層。
 *
 * 提供：
 *   - initBluetooth        ：第一次進入功能時呼叫，準備藍牙堆疊
 *   - startBroadcasting    ：開始廣播自己
 *   - stopBroadcasting     ：停止廣播自己
 *   - getStatus            ：取得目前藍牙狀態（給 UI 顯示開關）
 *   - scanNearby           ：掃描附近裝置一輪
 *   - sendMessage          ：傳訊息給某個附近用戶
 *   - subscribeMessages    ：訂閱收訊事件
 *   - generateLocalId      ：產生本機隨機短 ID
 */

import {
  canAdvertise,
  startAdvertising,
  stopAdvertising,
  getIsAdvertising,
  onMessageReceived,
} from "./bluetoothPeripheral";
import {
  ensureInitialized,
  isBluetoothEnabled,
  scanNearby as centralScan,
  sendMessageTo,
} from "./bluetoothCentral";
import type {
  BluetoothStatus,
  IncomingMessage,
  NearbyDevice,
  OutgoingMessage,
} from "./bluetoothTypes";

/** Re-export 型別供 UI 直接使用 */
export type { BluetoothStatus, IncomingMessage, NearbyDevice, OutgoingMessage };

// 本機這次 session 的 localId；初始化時隨機產生並保留
let cachedLocalId = "";

/**
 * 初始化藍牙堆疊（請在第一次使用功能時呼叫）
 *
 * 這個函式只做：
 *   1. 喚醒 BleClient（要權限）
 *   2. 確認藍牙開關狀態
 * 不會自動開始廣播或掃描；UI 端決定何時 start。
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
    isScanning: false, // 目前掃描是 one-shot，沒有長駐狀態
  };
}

/**
 * 開始廣播自己。若還沒 localId 會自動產生一個。
 * 之後對方掃到的「名稱」就是這個 localId。
 */
export async function startBroadcasting(): Promise<{ localId: string; success: boolean }> {
  if (!cachedLocalId) cachedLocalId = generateLocalId();
  const success = await startAdvertising(cachedLocalId);
  return { localId: cachedLocalId, success };
}

/** 停止廣播自己 */
export async function stopBroadcasting(): Promise<void> {
  await stopAdvertising();
}

/** 取得本機 localId（廣播沒開過則為空字串） */
export function getLocalId(): string {
  return cachedLocalId;
}

/**
 * 掃描附近裝置一輪
 *
 * @param onlyGuardiaUsers true = 僅同 App 用戶；false = 所有 BLE 裝置（含耳機等）
 */
export async function scanNearby(onlyGuardiaUsers: boolean): Promise<NearbyDevice[]> {
  return centralScan(onlyGuardiaUsers);
}

/**
 * 傳訊息給附近某裝置（必須是同 App 用戶）
 *
 * @param deviceId    對方裝置 ID（從 scanNearby 取得）
 * @param text        訊息內容
 * @param location    （可選）附帶的 GPS 位置
 */
export async function sendMessage(
  deviceId: string,
  text: string,
  location?: { lat: number; lng: number },
): Promise<{ success: boolean; error?: string }> {
  if (!cachedLocalId) cachedLocalId = generateLocalId();
  const message: OutgoingMessage = {
    from: cachedLocalId,
    text,
    location,
    timestamp: Date.now(),
  };
  return sendMessageTo(deviceId, message);
}

/**
 * 訂閱「收到訊息」事件。
 *
 * @returns unsubscribe 函式；元件 unmount 時必須呼叫，否則 listener 會累積導致記憶體洩漏
 */
export async function subscribeMessages(
  handler: (msg: IncomingMessage) => void,
): Promise<() => void> {
  return onMessageReceived(handler);
}

/**
 * 產生本機 localId（4 字元隨機字串，廣播封包夠塞且仍有可讀性）
 *
 * 注意：每次 App 啟動會重新產生；若要永久 ID 應改存進 localStorage / SQLite。
 * v1 先用 session-scoped 簡化邏輯。
 */
export function generateLocalId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去除易混淆字元
  let id = "";
  for (let i = 0; i < 4; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}
