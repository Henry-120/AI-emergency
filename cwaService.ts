import { BACKEND } from "./backend";
import { distanceKm } from "./offlineSafetyService";

export interface EarthquakeAlert {
  magnitude: number;
  location: string;
  time?: string;
  id?: number | string;
  originTime?: string;
  depth?: number;
  epicenterLat?: number | null;
  epicenterLng?: number | null;
  reportColor?: string;
  web?: string;
}

export async function fetchLatestAlert(): Promise<EarthquakeAlert | null> {
  try {
    const res = await fetch(`${BACKEND}/api/weather/latest`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    if (data?.error) {
      throw new Error(data.error);
    }
    return {
      magnitude: Number(data.magnitude),
      location: data.location || "未知位置",
      time: data.time || "",
      depth: data.depth != null ? Number(data.depth) : undefined,
      epicenterLat: data.epicenterLat != null ? Number(data.epicenterLat) : null,
      epicenterLng: data.epicenterLng != null ? Number(data.epicenterLng) : null,
    };
  } catch (e) {
    console.warn("無法從後端取得地震資料", e);
    return null;
  }
}

// 判斷「強震」與「使用者位於危險範圍內」的門檻。CWA 開放資料不含逐點震度，
// 故以規模 + 與震央距離作為保守的近似判斷，而非官方震度分級。
export const SEVERE_EARTHQUAKE_MAGNITUDE = 5.0;
export const SEVERE_EARTHQUAKE_DANGER_RADIUS_KM = 100;
const SEVERE_EARTHQUAKE_RECENCY_MS = 10 * 60 * 1000;

/** 是否為「剛發生、規模達強震門檻、且使用者在受影響範圍內」的地震警報。 */
export function isSevereNearbyEarthquake(
  alert: EarthquakeAlert,
  location: { lat: number; lng: number } | null,
): boolean {
  if (!location) return false;
  if (alert.epicenterLat == null || alert.epicenterLng == null) return false;
  if (!Number.isFinite(alert.magnitude) || alert.magnitude < SEVERE_EARTHQUAKE_MAGNITUDE) {
    return false;
  }

  const originMs = alert.time ? new Date(alert.time).getTime() : NaN;
  if (!Number.isFinite(originMs) || Date.now() - originMs > SEVERE_EARTHQUAKE_RECENCY_MS) {
    return false;
  }

  const distance = distanceKm(
    location.lat,
    location.lng,
    alert.epicenterLat,
    alert.epicenterLng,
  );
  return distance <= SEVERE_EARTHQUAKE_DANGER_RADIUS_KM;
}

export async function fetchEarthquakes(): Promise<EarthquakeAlert[]> {
  try {
    const res = await fetch(`${BACKEND}/api/weather/list`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn("無法從後端取得地震列表", e);
    return [];
  }
}
