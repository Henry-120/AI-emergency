/**
 * GuardiaAI 藍牙模組 - 共用常數
 *
 * 此檔內的 UUID **必須與 iOS 端 BlePeripheralManager.swift 完全一致**，
 * 否則 Central 端會掃不到、寫不進 Peripheral 端。
 */

/** GuardiaAI 服務 UUID — 同 App 互相識別的依據 */
export const GUARDIA_SERVICE_UUID = "7E5F9B40-9C8E-4F1A-A0D3-2C1B7E0A5F40";

/** 收件特徵值 UUID — Central 將訊息寫入此特徵 */
export const GUARDIA_INBOX_CHAR_UUID = "7E5F9B40-9C8E-4F1A-A0D3-2C1B7E0A5F41";

// ---------------------------------------------------------------------------
// 掃描
// ---------------------------------------------------------------------------

/** 一輪掃描的自動停止時間。掃描本身已改為可取消的串流式，這只是保險。 */
export const DEFAULT_SCAN_DURATION_MS = 8000;

/**
 * 同一裝置的掃描回呼節流間隔。
 *
 * requestLEScan 必須開 allowDuplicates 才能持續更新 RSSI，代價是同一裝置每收到
 * 一個廣告封包就回呼一次（8 秒內可達數百次）。這裡節流，避免無謂的重繪與耗電。
 */
export const SCAN_THROTTLE_MS = 500;

// ---------------------------------------------------------------------------
// 訊息傳輸
// ---------------------------------------------------------------------------

/**
 * 單一 BLE 寫入封包的最大 bytes。
 *
 * iPhone 對 iPhone 的 ATT MTU 通常可協商到 185–512 bytes，但 @capacitor-community/
 * bluetooth-le 未暴露 MTU 查詢，故此處先取保守值。實機實測出安全上限後可調高。
 *
 * 注意：這是**單包**上限，不是訊息上限。超過此長度的訊息會由 bluetoothChunking
 * 自動拆成多包傳送，使用者可輸入的長度不再受它限制。
 */
export const MAX_FRAME_BYTES = 180;

/**
 * 單則訊息（序列化後）的總長度上限。
 *
 * 分片讓長訊息成為可能，但仍需上限，以防惡意端用超長訊息灌爆記憶體。
 */
export const MAX_MESSAGE_BYTES = 2000;

/** 分片重組逾時。超過此時間仍未收齊的分片會被丟棄，避免殘片永久佔用記憶體。 */
export const CHUNK_REASSEMBLY_TIMEOUT_MS = 10000;

// ---------------------------------------------------------------------------
// 連線
// ---------------------------------------------------------------------------

/**
 * 連線閒置多久後才斷開。
 *
 * 舊版每則訊息都 connect → write → disconnect，連續傳訊時延遲很高。
 * 現在傳完先保留連線，這段時間內再傳給同一對象即可直接複用。
 */
export const CONNECTION_IDLE_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// 身分
// ---------------------------------------------------------------------------

/**
 * 本機識別碼長度。
 *
 * 舊版為 4 字元（32⁴ ≈ 100 萬組）。提高到 6 字元後為 32⁶ ≈ 10 億組，
 * 同一場災害現場的碰撞機率趨近於零，而廣播封包仍塞得下。
 */
export const LOCAL_ID_LENGTH = 6;

/** 產生識別碼用的字元集。刻意排除易混淆的 I / O / 0 / 1。 */
export const LOCAL_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 識別碼在 localStorage 的鍵名 */
export const LOCAL_ID_STORAGE_KEY = "guardia.bluetooth.localId";

// ---------------------------------------------------------------------------
// 收件匣與狀態
// ---------------------------------------------------------------------------

/** 收件匣在 localStorage 的鍵名 */
export const INBOX_STORAGE_KEY = "guardia.bluetooth.inbox";

/** 收件匣最多保留幾則訊息（避免無限成長） */
export const INBOX_MAX_MESSAGES = 200;

/** 藍牙狀態輪詢間隔。使用者可能隨時在系統設定關掉藍牙，UI 需要跟著更新。 */
export const STATUS_POLL_INTERVAL_MS = 3000;
