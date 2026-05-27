/**
 * GuardiaAI 藍牙模組 - Central 端（掃描附近 + 連線傳訊）
 *
 * 使用 @capacitor-community/bluetooth-le 套件。
 * 該套件只支援 Central 模式（這也是為何我們另外寫 Swift 處理 Peripheral）。
 */

import { BleClient, type ScanResult } from "@capacitor-community/bluetooth-le";
import {
  GUARDIA_SERVICE_UUID,
  GUARDIA_INBOX_CHAR_UUID,
  DEFAULT_SCAN_DURATION_MS,
  MAX_MESSAGE_BYTES,
} from "./bluetoothConstants";
import type { NearbyDevice, OutgoingMessage } from "./bluetoothTypes";

let initialized = false;

/** 初始化藍牙堆疊（套件要求第一次使用前必須呼叫） */
export async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  await BleClient.initialize({ androidNeverForLocation: true });
  initialized = true;
}

/** 查詢藍牙是否啟用（裝置藍牙開關打開） */
export async function isBluetoothEnabled(): Promise<boolean> {
  await ensureInitialized();
  try {
    return await BleClient.isEnabled();
  } catch {
    return false;
  }
}

/**
 * 掃描附近裝置一段時間，回傳清單
 *
 * @param onlyGuardiaUsers true = 只列同 App 用戶；false = 全部 BLE 裝置都列
 * @param durationMs       掃描秒數（預設 8 秒）
 *
 * 同 App 用戶會用 service UUID 過濾掃出來；
 * 全部裝置時不下 filter，會掃到耳機/手環/其他手機等。
 */
export async function scanNearby(
  onlyGuardiaUsers: boolean,
  durationMs: number = DEFAULT_SCAN_DURATION_MS,
): Promise<NearbyDevice[]> {
  await ensureInitialized();

  // 用 Map 去重：同一裝置短時間會被掃到多次，只保留最後一筆（RSSI 最新）
  const seen = new Map<string, NearbyDevice>();

  await BleClient.requestLEScan(
    {
      // 給 service UUID 過濾 → 只回傳同 App 用戶；
      // 空陣列 → 回傳所有 BLE 廣告
      services: onlyGuardiaUsers ? [GUARDIA_SERVICE_UUID] : [],
      // allowDuplicates 必須 true 才能更新 RSSI
      allowDuplicates: true,
    },
    (result: ScanResult) => {
      const isGuardia = (result.uuids ?? []).some(
        (u) => u.toLowerCase() === GUARDIA_SERVICE_UUID.toLowerCase(),
      );
      // iOS 把 localId 放在 LocalName；對方若不是 GuardiaAI 或在背景時可能拿不到
      const localName = result.localName ?? undefined;
      seen.set(result.device.deviceId, {
        deviceId: result.device.deviceId,
        name: localName ?? result.device.name ?? "(無名稱)",
        // 只有 GuardiaAI 用戶 + 有 LocalName 才設 localId（= 對方 app 廣播時宣告的短 ID）
        localId: isGuardia ? localName : undefined,
        rssi: result.rssi ?? -100,
        isGuardiaUser: isGuardia,
        lastSeenAt: Date.now(),
      });
    },
  );

  // 等指定秒數後停止掃描，回傳結果
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  await BleClient.stopLEScan();

  return Array.from(seen.values()).sort((a, b) => b.rssi - a.rssi);
}

/**
 * 傳訊息給某個附近的同 App 用戶
 *
 * 流程：connect → write to inbox characteristic → disconnect
 * 每次傳訊都重新連線。雖然較耗時，但簡單可靠，適合 v1。
 *
 * @param deviceId 對方裝置 ID（從 scanNearby 取得）
 * @param message  要傳的訊息物件（會 JSON.stringify 後寫入）
 */
export async function sendMessageTo(
  deviceId: string,
  message: OutgoingMessage,
): Promise<{ success: boolean; error?: string }> {
  await ensureInitialized();

  const payload = JSON.stringify(message);
  const bytes = new TextEncoder().encode(payload);
  if (bytes.byteLength > MAX_MESSAGE_BYTES) {
    return { success: false, error: `訊息過長（>${MAX_MESSAGE_BYTES} bytes）` };
  }

  try {
    await BleClient.connect(deviceId, () => {
      // onDisconnect callback，目前無需處理
    });

    // 套件接受 DataView 或 number[]；用 DataView 比較直觀。
    // 使用 byteOffset/byteLength 防禦：TextEncoder 目前回傳的 Uint8Array
    // 都是 fresh buffer (offset=0)，但寫法保守一些不會出錯。
    const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    await BleClient.write(
      deviceId,
      GUARDIA_SERVICE_UUID,
      GUARDIA_INBOX_CHAR_UUID,
      dataView,
    );

    await BleClient.disconnect(deviceId);
    return { success: true };
  } catch (err) {
    // 連線可能因對方未開 App、距離太遠、藍牙堆疊忙碌而失敗
    const errMsg = err instanceof Error ? err.message : String(err);
    try {
      await BleClient.disconnect(deviceId);
    } catch {
      /* ignore */
    }
    return { success: false, error: errMsg };
  }
}
