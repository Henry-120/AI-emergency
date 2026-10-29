import { getBackendToken } from "./authService";
import { BACKEND } from "./backend";
import {
  CaseStatus,
  PendingSelfStatus,
  readPendingSelfStatus,
  rememberSelfStatus,
  savePendingSelfStatus,
  SelfStatus,
  StatusSource,
} from "./caseStatus";

/** 自己目前的狀況（GET/PUT /api/my-status）。 */
export interface MyCase {
  condition: CaseStatus | null;
  conditionSource: StatusSource | null;
  conditionUpdatedAt: string | null;
  selfCondition: SelfStatus | null;
  selfConditionAt: string | null;
  requiresRescue: boolean;
  hasLocation: boolean;
  updatedAt: string | null;
}

const REQUEST_TIMEOUT_MS = 8000;

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

async function requestMyStatus(method: "GET" | "PUT", body?: PendingSelfStatus): Promise<MyCase> {
  const token = getBackendToken();
  if (!token) throw new Error("請先登入，才能在救援地圖上標示狀態");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${BACKEND}/api/my-status`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`狀態${method === "GET" ? "讀取" : "更新"}失敗（HTTP ${response.status}）`);
    return (await response.json()) as MyCase;
  } finally {
    clearTimeout(timeout);
  }
}

export function fetchMyCase(): Promise<MyCase> {
  return requestMyStatus("GET");
}

/**
 * 送出自己標示的狀態。離線或送不出去時先存在手機上（queued: true），
 * 恢復連線後由 flushPendingMyStatus 補送。
 */
export async function submitMyStatus(
  status: SelfStatus,
  location: { lat: number; lng: number } | null,
  now = new Date(),
): Promise<{ myCase: MyCase | null; queued: boolean }> {
  const pending: PendingSelfStatus = {
    condition: status,
    latitude: location?.lat ?? null,
    longitude: location?.lng ?? null,
    reported_at: now.toISOString(),
  };
  rememberSelfStatus(status, pending.reported_at);
  if (isOffline()) {
    savePendingSelfStatus(pending);
    return { myCase: null, queued: true };
  }
  try {
    const myCase = await requestMyStatus("PUT", pending);
    // 這次送到了，比它舊的待送狀態就不需要了。
    savePendingSelfStatus(null);
    return { myCase, queued: false };
  } catch (error) {
    console.warn("狀態送出失敗，先存在手機上等連線恢復", error);
    savePendingSelfStatus(pending);
    return { myCase: null, queued: true };
  }
}

/** 補送離線時按下的狀態；沒有待送的、或還是送不出去時什麼都不做，下次再試。 */
export async function flushPendingMyStatus(): Promise<MyCase | null> {
  const pending = readPendingSelfStatus();
  if (!pending || isOffline() || !getBackendToken()) return null;
  try {
    const myCase = await requestMyStatus("PUT", pending);
    // 送的過程中使用者可能又按了新的，只清掉剛送出的這一筆。
    if (readPendingSelfStatus()?.reported_at === pending.reported_at) savePendingSelfStatus(null);
    return myCase;
  } catch (error) {
    console.warn("補送狀態失敗，下次連線再試", error);
    return null;
  }
}
