import { getBackendToken } from "./authService";
import { buildBackendUrl } from "./backend";
import type { DisasterCategory } from "./disasterCategories";

/**
 * 使用者自己在救援地圖上釘選的災情（像 Google 地圖那樣），所有人都看得到。
 * 位置是使用者在地圖上對準的地方，不是他的 GPS；只有標記的人自己能修改、刪除。
 */
export interface HazardPin {
  id: string;
  category: DisasterCategory;
  note: string;
  latitude: number;
  longitude: number;
  distance_km: number | null;
  created_at: string;
  updated_at: string;
  /** 是不是自己標的；後端不會告訴別人是誰標的 */
  mine: boolean;
}

export interface HazardPinInput {
  category: DisasterCategory;
  note: string;
  latitude: number;
  longitude: number;
}

const REQUEST_TIMEOUT_MS = 8000;

async function request<T>(path: string, init: RequestInit = {}, search?: Record<string, string>): Promise<T> {
  const token = getBackendToken();
  if (!token) throw new Error("請先登入，才能標記或查看災情");
  const url = buildBackendUrl(path);
  Object.entries(search ?? {}).forEach(([key, value]) => url.searchParams.set(key, value));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      // 後端會說明原因，例如「只能修改自己標記的災情」「24 小時內最多只能標記 30 個災情」。
      const body = await response.json().catch(() => null);
      throw new Error(typeof body?.detail === "string" ? body.detail : `災情標記失敗（HTTP ${response.status}）`);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("連線逾時，請稍後再試");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function fetchNearbyHazardPins(location: { lat: number; lng: number }, radiusKm = 50) {
  return request<HazardPin[]>("/api/hazard-pins/nearby", {}, {
    latitude: String(location.lat),
    longitude: String(location.lng),
    radius_km: String(radiusKm),
  });
}

export function createHazardPin(input: HazardPinInput) {
  return request<HazardPin>("/api/hazard-pins", { method: "POST", body: JSON.stringify(input) });
}

export function updateHazardPin(id: string, input: Partial<HazardPinInput>) {
  return request<HazardPin>(`/api/hazard-pins/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteHazardPin(id: string) {
  return request<void>(`/api/hazard-pins/${encodeURIComponent(id)}`, { method: "DELETE" });
}
