/**
 * GuardiaAI 藍牙模組 - 本機識別碼
 *
 * 本機 localId 是對話歷史的 key，也是對方在附近清單中看到的名字。
 *
 * 舊版每次啟動 App 都重新產生一組，導致重開後所有對話對不起來、對方也認不出
 * 你是同一個人。現在持久化到 localStorage。
 */

import {
  LOCAL_ID_ALPHABET,
  LOCAL_ID_LENGTH,
  LOCAL_ID_STORAGE_KEY,
} from "./bluetoothConstants";

/** 合法識別碼的樣式（字元集 + 長度都要對） */
const ID_PATTERN = new RegExp(`^[${LOCAL_ID_ALPHABET}]{${LOCAL_ID_LENGTH}}$`);

/**
 * 產生一組隨機識別碼。
 *
 * 優先使用 crypto.getRandomValues；環境不支援時退回 Math.random。
 * 識別碼只用於「認出是同一個人」，不是安全憑證，故退回方案可接受。
 */
export function generateLocalId(length: number = LOCAL_ID_LENGTH): string {
  const alphabet = LOCAL_ID_ALPHABET;
  const out: string[] = [];

  const cryptoObj = typeof crypto !== "undefined" ? crypto : undefined;
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(length);
    cryptoObj.getRandomValues(bytes);
    for (let i = 0; i < length; i++) {
      out.push(alphabet[bytes[i] % alphabet.length]);
    }
  } else {
    for (let i = 0; i < length; i++) {
      out.push(alphabet[Math.floor(Math.random() * alphabet.length)]);
    }
  }

  return out.join("");
}

/** 驗證一個字串是否為合法識別碼 */
export function isValidLocalId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/**
 * 取得本機識別碼；不存在（或存的值已損毀 / 是舊版的 4 字元格式）就產生一組新的並存起來。
 */
export function getOrCreateLocalId(): string {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(LOCAL_ID_STORAGE_KEY);
  } catch {
    // localStorage 不可用（隱私模式等）→ 退回產生臨時 ID
    return generateLocalId();
  }

  if (isValidLocalId(saved)) return saved;

  const fresh = generateLocalId();
  try {
    localStorage.setItem(LOCAL_ID_STORAGE_KEY, fresh);
  } catch {
    // 存不進去也還是可以用，只是下次重開會換一組
  }
  return fresh;
}
