/**
 * GuardiaAI SOS 中繼 - 求救內容組裝
 *
 * 把「使用者這次想送出什麼」組成 SosPayload。這是設計文件（
 * docs/superpowers/specs/2026-07-13-bluetooth-sos-relay-design.md）裡提到、
 * 但先前一直沒人接上的那一段：從 medicalCardService 抓資料塞進封包。
 *
 * 刻意只抓血型、藥物過敏、慢性病三項——不是整張醫療卡。姓名、身分證、緊急聯絡人
 * 等其他欄位與「附近的人能不能救你」無關，不必冒險夾帶。
 *
 * 醫療資料是否附上由呼叫端（UI）決定，預設不附——即使會被加密，是否讓後端
 * 也知道自己的病史，應該是使用者每次求救當下自己選的，不是系統幫他決定的。
 */

import { getOrCreateLocalId } from "../bluetooth/bluetoothIdentity";
import { getMedicalCard } from "../medicalCardService";
import type { SosPayload } from "./sosTypes";

/** 嘗試讀取裝置電量（0–100）。環境不支援時回傳 undefined，不阻擋求救送出。 */
export async function readBatteryLevel(): Promise<number | undefined> {
  try {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{ level: number }>;
    };
    if (!nav.getBattery) return undefined;
    const battery = await nav.getBattery();
    return Math.round(battery.level * 100);
  } catch {
    return undefined;
  }
}

/** 從醫療卡抓出要放進求救封包的三項摘要；三項皆空則回傳 undefined（不放這個欄位）。 */
function extractMedicalSummary(): SosPayload["medical"] {
  const card = getMedicalCard();
  const bloodType = card.bloodType.trim();
  const drugAllergies = card.drugAllergies.trim();
  const chronicConditions = card.chronicConditions.trim();

  if (!bloodType && !drugAllergies && !chronicConditions) return undefined;

  return {
    ...(bloodType && { bloodType }),
    ...(drugAllergies && { drugAllergies }),
    ...(chronicConditions && { chronicConditions }),
  };
}

export interface BuildSosPayloadOptions {
  /** 求救文字（可由語音輸入產生） */
  text: string;
  /** 目前位置；沒有定位權限或訊號時可省略 */
  location?: { lat: number; lng: number };
  /** 是否附上醫療卡摘要（血型/藥物過敏/慢性病）。預設 false。 */
  includeMedical?: boolean;
}

/**
 * 組出一份 SosPayload，供 sosCrypto.encryptForBackend 加密。
 *
 * `from` 一律用本機持久化的識別碼——與「附近的人」共用同一組身分，
 * 對方（若剛好也認得你）看到的是同一個人。
 */
export async function buildSosPayload(options: BuildSosPayloadOptions): Promise<SosPayload> {
  const battery = await readBatteryLevel();

  return {
    from: getOrCreateLocalId(),
    text: options.text,
    location: options.location,
    medical: options.includeMedical ? extractMedicalSummary() : undefined,
    battery,
    timestamp: Date.now(),
  };
}
