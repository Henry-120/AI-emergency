/**
 * GuardiaAI 藍牙模組 - 收訊封包驗證
 *
 * 為什麼需要這個檔案：
 *
 * 藍牙收到的資料來自**我們無法控制的裝置**。舊版直接把 JSON.parse 的結果展開進
 * React state，只要對方送來缺欄位或型別錯誤的 payload，UI 就會在
 * `new Date(timestamp)` 或 `location.lat.toFixed(4)` 崩潰。
 *
 * 導入 SOS 多跳中繼後，封包來源會變成任意陌生人 —— 這裡就是唯一的把關點。
 * 驗證不通過的封包一律丟棄，絕不進入畫面。
 */

import type { OutgoingMessage } from "./bluetoothTypes";

/** 訊息文字的長度上限（字元數）。防止惡意端用超長字串灌爆畫面。 */
const MAX_TEXT_LENGTH = 500;

/** 識別碼長度上限。給舊版 4 字元的相容空間，故不寫死等於 LOCAL_ID_LENGTH。 */
const MAX_FROM_LENGTH = 16;

/** 時間戳記的合理範圍：2020-01-01 之後，且不超過現在 + 1 天（容忍時鐘誤差） */
const MIN_TIMESTAMP = Date.UTC(2020, 0, 1);
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** 驗證 location 欄位（可有可無，但存在就必須合法） */
function isValidLocation(v: unknown): boolean {
  if (v === undefined || v === null) return true; // 未提供 → 合法

  if (typeof v !== "object") return false;
  const loc = v as Record<string, unknown>;

  if (!isFiniteNumber(loc.lat) || loc.lat < -90 || loc.lat > 90) return false;
  if (!isFiniteNumber(loc.lng) || loc.lng < -180 || loc.lng > 180) return false;

  return true;
}

/**
 * 型別守衛：這包資料是否為一則合法的訊息。
 *
 * @param now 當下時間（可注入以便測試）
 */
export function isValidMessage(
  value: unknown,
  now: number = Date.now(),
): value is OutgoingMessage {
  if (typeof value !== "object" || value === null) return false;
  const msg = value as Record<string, unknown>;

  // from：發送者識別碼
  if (typeof msg.from !== "string") return false;
  if (msg.from.length === 0 || msg.from.length > MAX_FROM_LENGTH) return false;

  // text：訊息內容
  if (typeof msg.text !== "string") return false;
  if (msg.text.length > MAX_TEXT_LENGTH) return false;

  // kind：可選；存在時只接受已知值（來源是不可信裝置，不放行任意字串）
  if (msg.kind !== undefined && msg.kind !== "chat" && msg.kind !== "survival") {
    return false;
  }

  // timestamp：必須是合理範圍內的數字，否則 new Date() 會產出 Invalid Date
  if (!isFiniteNumber(msg.timestamp)) return false;
  if (msg.timestamp < MIN_TIMESTAMP) return false;
  if (msg.timestamp > now + MAX_CLOCK_SKEW_MS) return false;

  // location：可選，但存在就必須合法
  if (!isValidLocation(msg.location)) return false;

  return true;
}

/**
 * 解析並驗證一則收到的訊息。
 *
 * @returns 合法則回傳訊息物件；任何一步失敗都回傳 null（呼叫端應直接丟棄）。
 */
export function parseIncomingMessage(
  raw: string,
  now: number = Date.now(),
): OutgoingMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // 不是合法 JSON
  }

  if (!isValidMessage(parsed, now)) return null;
  return parsed;
}
