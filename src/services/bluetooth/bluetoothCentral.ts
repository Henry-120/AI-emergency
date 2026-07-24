/**
 * GuardiaAI 藍牙模組 - Central 端（掃描附近 + 連線傳訊）
 *
 * 使用 @capacitor-community/bluetooth-le 套件。
 * 該套件只支援 Central 模式（這也是為何我們另外寫 Swift 處理 Peripheral）。
 *
 * 與舊版的差異：
 *   - 掃描可取消（AbortSignal），且掃到一台就即時回報，不必等整輪結束
 *   - 掃描回呼有節流，不再每個廣告封包都重繪
 *   - 併發保護移到本層（stopLEScan 是全域的，不能靠 UI 的旗標擋）
 *   - 傳訊改為連線複用 + 自動分片，不再每則訊息都 connect/disconnect
 */

import { BleClient, type ScanResult } from "@capacitor-community/bluetooth-le";
import {
  CONNECTION_IDLE_TIMEOUT_MS,
  DEFAULT_SCAN_DURATION_MS,
  GUARDIA_INBOX_CHAR_UUID,
  GUARDIA_SERVICE_UUID,
  MAX_FRAME_BYTES,
  MAX_MESSAGE_BYTES,
  PACKET_KIND_CHAT,
  PACKET_KIND_SOS,
  SCAN_THROTTLE_MS,
} from "./bluetoothConstants";
import { generateFrameId, splitIntoFrames } from "./bluetoothChunking";
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

// ---------------------------------------------------------------------------
// 掃描
// ---------------------------------------------------------------------------

/**
 * 目前這輪掃描的中止函式。
 *
 * stopLEScan() 是**全域**的——若兩輪掃描重疊，先結束的那輪會把另一輪一起停掉。
 * 因此併發保護必須做在服務層，不能依賴 UI 自己的旗標。
 */
let activeScanStop: (() => void) | null = null;

/** 掃描是否正在進行（供 getStatus 回報） */
export function isScanning(): boolean {
  return activeScanStop !== null;
}

/** 立刻停止目前的掃描（若有） */
export function stopScan(): void {
  activeScanStop?.();
}

export interface ScanOptions {
  /** true = 只列同 App 用戶；false = 所有 BLE 裝置都列 */
  onlyGuardiaUsers: boolean;
  /** 這輪掃描最長跑多久 */
  durationMs?: number;
  /** 外部取消用 */
  signal?: AbortSignal;
  /** 掃到一台就回報一台，讓 UI 即時浮現，不必等整輪結束 */
  onDevice?: (device: NearbyDevice) => void;
}

/**
 * 掃描附近裝置。
 *
 * 會在下列任一情況結束：durationMs 到期、signal 被 abort、或呼叫 stopScan()。
 *
 * @returns 這輪掃到的所有裝置（依訊號強度排序）
 */
export async function scanNearby(options: ScanOptions): Promise<NearbyDevice[]> {
  const {
    onlyGuardiaUsers,
    durationMs = DEFAULT_SCAN_DURATION_MS,
    signal,
    onDevice,
  } = options;

  await ensureInitialized();

  // 併發保護：先把上一輪停掉，否則兩輪會互相干擾
  activeScanStop?.();

  const seen = new Map<string, NearbyDevice>();
  const lastEmitAt = new Map<string, number>();

  return new Promise<NearbyDevice[]>((resolve) => {
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (finished) return;
      finished = true;

      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      if (activeScanStop === finish) activeScanStop = null;

      // stopLEScan 失敗不影響結果（可能藍牙已被關閉）
      BleClient.stopLEScan().catch(() => {});

      resolve(Array.from(seen.values()).sort((a, b) => b.rssi - a.rssi));
    };

    activeScanStop = finish;

    if (signal?.aborted) {
      finish();
      return;
    }
    signal?.addEventListener("abort", finish);

    BleClient.requestLEScan(
      {
        // 給 service UUID 過濾 → 只回傳同 App 用戶；空陣列 → 所有 BLE 廣告
        services: onlyGuardiaUsers ? [GUARDIA_SERVICE_UUID] : [],
        // allowDuplicates 必須 true，RSSI 才會持續更新
        allowDuplicates: true,
      },
      (result: ScanResult) => {
        if (finished) return;

        const deviceId = result.device.deviceId;

        // 節流：同一裝置每收到一個廣告封包就回呼一次，8 秒內可達數百次。
        // 限制更新頻率，避免無謂的重繪與耗電。
        const now = Date.now();
        const last = lastEmitAt.get(deviceId) ?? 0;
        if (now - last < SCAN_THROTTLE_MS) return;
        lastEmitAt.set(deviceId, now);

        const isGuardia = (result.uuids ?? []).some(
          (u) => u.toLowerCase() === GUARDIA_SERVICE_UUID.toLowerCase(),
        );
        // iOS 把 localId 放在 LocalName；對方若不是 GuardiaAI 或在背景時可能拿不到
        const localName = result.localName ?? undefined;

        const device: NearbyDevice = {
          deviceId,
          name: localName ?? result.device.name ?? "(無名稱)",
          localId: isGuardia ? localName : undefined,
          rssi: result.rssi ?? -100,
          isGuardiaUser: isGuardia,
          lastSeenAt: now,
        };

        seen.set(deviceId, device);
        onDevice?.(device);
      },
    ).catch(() => {
      // 掃描根本沒起來（權限被拒、藍牙關閉等）→ 直接結束，回傳空清單
      finish();
    });

    timer = setTimeout(finish, durationMs);
  });
}

// ---------------------------------------------------------------------------
// 連線池
// ---------------------------------------------------------------------------

interface PooledConnection {
  idleTimer: ReturnType<typeof setTimeout>;
}

/**
 * 已連線的裝置。
 *
 * 舊版每則訊息都 connect → write → disconnect，連續傳訊時每則都得重新握手，延遲很高。
 * 現在傳完先留著連線，閒置逾時才斷開；期間再傳給同一對象即可直接複用。
 */
const connections = new Map<string, PooledConnection>();

function scheduleDisconnect(deviceId: string): void {
  const existing = connections.get(deviceId);
  if (existing) clearTimeout(existing.idleTimer);

  const idleTimer = setTimeout(() => {
    connections.delete(deviceId);
    BleClient.disconnect(deviceId).catch(() => {});
  }, CONNECTION_IDLE_TIMEOUT_MS);

  connections.set(deviceId, { idleTimer });
}

function forgetConnection(deviceId: string): void {
  const existing = connections.get(deviceId);
  if (existing) clearTimeout(existing.idleTimer);
  connections.delete(deviceId);
}

/** 確保與該裝置已連線（已在連線池中則直接複用） */
async function ensureConnected(deviceId: string): Promise<void> {
  if (connections.has(deviceId)) return;

  await BleClient.connect(deviceId, () => {
    // 對方主動斷線（走遠、關 App）→ 從連線池移除，下次傳訊會重新連
    forgetConnection(deviceId);
  });
}

/** 斷開所有連線（離開藍牙功能時呼叫） */
export async function disconnectAll(): Promise<void> {
  const ids = Array.from(connections.keys());
  for (const id of ids) {
    forgetConnection(id);
    await BleClient.disconnect(id).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// 傳訊
// ---------------------------------------------------------------------------

/**
 * 把一段已經加上「訊息種類」判別 byte 的 bytes 分片寫入對方的 inbox 特徵值。
 *
 * 聊天訊息與 SOS 封包共用這條傳輸機制——分片、連線複用、逾時斷線都相同，
 * 差別只在 kind byte 讓收方知道該怎麼解析。
 */
async function writeFramedPayload(
  deviceId: string,
  kind: number,
  body: Uint8Array,
): Promise<{ success: boolean; error?: string }> {
  await ensureInitialized();

  const payload = new Uint8Array(body.byteLength + 1);
  payload[0] = kind;
  payload.set(body, 1);

  if (payload.byteLength > MAX_MESSAGE_BYTES) {
    return { success: false, error: `內容過長（>${MAX_MESSAGE_BYTES} bytes）` };
  }

  let frames: Uint8Array[];
  try {
    frames = splitIntoFrames(generateFrameId(), payload, MAX_FRAME_BYTES);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  try {
    await ensureConnected(deviceId);

    for (const frame of frames) {
      // 以 byteOffset/byteLength 建構 DataView：分片是 subarray 產生的 view，
      // 不一定從 buffer 開頭起算，直接用 frame.buffer 會送出整個底層 buffer。
      const dataView = new DataView(
        frame.buffer,
        frame.byteOffset,
        frame.byteLength,
      );
      await BleClient.write(
        deviceId,
        GUARDIA_SERVICE_UUID,
        GUARDIA_INBOX_CHAR_UUID,
        dataView,
      );
    }

    // 傳送成功 → 保留連線，重設閒置計時
    scheduleDisconnect(deviceId);
    return { success: true };
  } catch (err) {
    // 連線可能因對方未開 App、距離太遠、藍牙堆疊忙碌而失敗
    const errMsg = err instanceof Error ? err.message : String(err);

    // 壞掉的連線不能留在池裡，否則下次會複用到一條已死的連線
    forgetConnection(deviceId);
    await BleClient.disconnect(deviceId).catch(() => {});

    return { success: false, error: errMsg };
  }
}

/**
 * 傳訊息給某個附近的同 App 用戶。
 *
 * 訊息會被序列化成 JSON，視長度自動分片，逐片寫入對方的 inbox 特徵值。
 * 連線在傳送後保留一段時間（見 CONNECTION_IDLE_TIMEOUT_MS），供後續訊息複用。
 *
 * @param deviceId 對方裝置 ID（從 scanNearby 取得）
 * @param message  要傳的訊息物件
 */
export async function sendMessageTo(
  deviceId: string,
  message: OutgoingMessage,
): Promise<{ success: boolean; error?: string }> {
  const body = new TextEncoder().encode(JSON.stringify(message));
  return writeFramedPayload(deviceId, PACKET_KIND_CHAT, body);
}

/**
 * 傳一個 SOS 中繼封包（已編碼、已加密的 bytes）給附近某裝置。
 *
 * 對方不一定是「同 App 認識的朋友」，只是任何願意幫忙轉發的陌生人——
 * 因此這裡不做任何身分或內容檢查，原封不動送出即可，中繼者本來就解不開內容。
 *
 * @param deviceId    對方裝置 ID
 * @param packetBytes 已編碼的完整封包（sosProtocol.encodePacket 的輸出）
 */
export async function sendSosPacket(
  deviceId: string,
  packetBytes: Uint8Array,
): Promise<{ success: boolean; error?: string }> {
  return writeFramedPayload(deviceId, PACKET_KIND_SOS, packetBytes);
}
