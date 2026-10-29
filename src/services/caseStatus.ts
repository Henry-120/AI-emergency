/**
 * 受難者狀況（condition）：地圖上的五個按鈕，以及跟 AI 推斷合成後的狀況。
 * 合成規則在後端 backend/services/case_status.py，嚴重程度必須跟那邊一致。
 *
 * 這個模組不碰網路也不依賴登入。
 */

/** 使用者自己能選的五種狀態。 */
export type SelfStatus = "trapped" | "injured" | "need_supplies" | "safe" | "helping";
/** 合成後的狀況；「需要協助」只由 AI 推斷而來，內容不明但確定需要救援。 */
export type CaseStatus = SelfStatus | "need_help";
/** 狀況從哪裡來：本人回報，或 AI 從對話推斷。 */
export type StatusSource = "self" | "ai";
export type StatusTone = "critical" | "high" | "accent" | "safe" | "muted";

export interface StatusMeta {
  /** 按鈕上的完整說法 */
  label: string;
  /** 徽章上的短說法 */
  short: string;
  /** 狀態不能只靠顏色分辨（色盲也要看得懂），每種都有自己的形狀 */
  glyph: string;
  tone: StatusTone;
  /** 越大越緊急，清單依此排序 */
  severity: number;
}

export const STATUS_META: Record<CaseStatus, StatusMeta> = {
  trapped: { label: "受困，無法移動", short: "受困", glyph: "▲", tone: "critical", severity: 3 },
  injured: { label: "受傷，但能移動", short: "受傷", glyph: "◆", tone: "high", severity: 2 },
  need_help: { label: "需要協助", short: "需要協助", glyph: "◆", tone: "high", severity: 2 },
  need_supplies: { label: "安全，需要物資", short: "需要物資", glyph: "■", tone: "accent", severity: 1 },
  safe: { label: "已安全／已撤離", short: "已安全", glyph: "●", tone: "safe", severity: 0 },
  helping: { label: "我在協助其他人", short: "協助他人", glyph: "✚", tone: "muted", severity: 0 },
};

export const SELF_STATUS_OPTIONS: SelfStatus[] = ["trapped", "injured", "need_supplies", "safe", "helping"];
/** 「我需要協助」之後讓使用者選的三種。 */
export const NEED_HELP_OPTIONS: SelfStatus[] = ["trapped", "injured", "need_supplies"];
/** 求生指引裡地震安全確認、餘震詢問共用的按鈕字樣。 */
export const NEED_HELP_REPLY = "我需要協助";

export function needsRescue(status: CaseStatus | null | undefined): boolean {
  return status === "trapped" || status === "injured" || status === "need_help" || status === "need_supplies";
}

/** 對話裡的快速回覆按鈕對應到的狀態；只認按鈕上的固定字樣，不猜使用者自由輸入的句子。 */
const QUICK_REPLY_STATUS: Record<string, SelfStatus> = {
  ...Object.fromEntries(SELF_STATUS_OPTIONS.map((status) => [STATUS_META[status].label, status])),
  我目前安全: "safe",
  我人安全: "safe",
};

export function statusFromQuickReply(text: string): SelfStatus | null {
  return QUICK_REPLY_STATUS[text.trim()] ?? null;
}

const LAST_STATUS_KEY = "guardia:self-status";
const PENDING_STATUS_KEY = "guardia:pending-self-status";
const LAST_STATUS_TTL_MS = 24 * 60 * 60 * 1000;

/** 還沒送到後端的狀態（離線時按的），恢復連線後補送。 */
export interface PendingSelfStatus {
  condition: SelfStatus;
  latitude: number | null;
  longitude: number | null;
  /** 按下的時間（ISO）；後端用它判斷先後，晚送到的舊狀態不會蓋掉新的 */
  reported_at: string;
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readJson<T>(storage: Storage | null, key: string): T | null {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: Storage | null, key: string, value: unknown): void {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify(value));
  } catch {
    // 寫不進去（例如隱私模式）只影響離線補送，不影響這次的操作。
  }
}

function isSelfStatus(value: unknown): value is SelfStatus {
  return typeof value === "string" && (SELF_STATUS_OPTIONS as string[]).includes(value);
}

export function rememberSelfStatus(
  status: SelfStatus,
  at: string,
  storage: Storage | null = defaultStorage(),
): void {
  writeJson(storage, LAST_STATUS_KEY, { status, at });
}

/** 我最後在這支手機上選的狀況（24 小時內）。 */
export function getRememberedSelfStatus(
  storage: Storage | null = defaultStorage(),
  now = Date.now(),
): SelfStatus | null {
  const saved = readJson<{ status?: unknown; at?: string }>(storage, LAST_STATUS_KEY);
  if (!saved || !isSelfStatus(saved.status) || !saved.at) return null;
  const at = Date.parse(saved.at);
  return Number.isFinite(at) && now - at <= LAST_STATUS_TTL_MS ? saved.status : null;
}

export function readPendingSelfStatus(storage: Storage | null = defaultStorage()): PendingSelfStatus | null {
  const pending = readJson<PendingSelfStatus>(storage, PENDING_STATUS_KEY);
  return pending && isSelfStatus(pending.condition) && typeof pending.reported_at === "string" ? pending : null;
}

/** 只保留最新的一筆：離線時連按好幾次，恢復連線只需要送最後那個。 */
export function savePendingSelfStatus(
  pending: PendingSelfStatus | null,
  storage: Storage | null = defaultStorage(),
): void {
  writeJson(storage, PENDING_STATUS_KEY, pending);
}
