/**
 * GuardiaAI SOS 中繼 - 求救內容組裝（加密段）
 *
 * 只組裝**留在加密內容裡**的欄位：身分（真實姓名）、傷勢摘要、救援需求、
 * 行動能力、醫療摘要。緊急度、是否受困、GPS 位置、位置描述、裝置電量
 * 已經搬到明文標頭（見 sosProtocol.ts createHeader），不在這裡處理。
 *
 * 醫療摘要只抓血型、藥物過敏、慢性病三項——不是整張醫療卡。是否附上由
 * 呼叫端（UI）當次決定，預設不附。
 */

import { getCurrentUser } from "../authService";
import { getMedicalCard } from "../medicalCardService";
import type { SosPayload } from "./sosTypes";

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
  /** 傷勢摘要 */
  injurySummary: string;
  /** 救援需求清單 */
  rescueNeeds: string[];
  /** 行動能力 */
  mobilityStatus: "unknown" | "mobile" | "limited" | "immobile";
  /** 是否附上醫療卡摘要（血型/藥物過敏/慢性病）。預設 false。 */
  includeMedical?: boolean;
}

/**
 * 組出一份 SosPayload，供 sosCrypto.encryptForBackend 加密。
 *
 * `username` 是登入帳號的真實姓名，只有後端／救援單位解得開，中繼的
 * 陌生人看不到。發送者的短識別碼（fromLocalId）不在這裡——它放在明文標頭，
 * 好讓附近的人能認出是誰在求救並回應（見 sosProtocol.ts）。
 */
export function buildSosPayload(options: BuildSosPayloadOptions): SosPayload {
  return {
    username: getCurrentUser()?.username ?? "未知使用者",
    injurySummary: options.injurySummary,
    rescueNeeds: options.rescueNeeds,
    mobilityStatus: options.mobilityStatus,
    medical: options.includeMedical ? extractMedicalSummary() : undefined,
    timestamp: Date.now(),
  };
}

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
