import { BACKEND } from "./backend";
<<<<<<< HEAD
import { distanceKm } from "./offlineSafetyService";
=======
>>>>>>> 58fdbf595c177e942c8e1e94f609c964f5121f17

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
<<<<<<< HEAD
      depth: data.depth != null ? Number(data.depth) : undefined,
      epicenterLat: data.epicenterLat != null ? Number(data.epicenterLat) : null,
      epicenterLng: data.epicenterLng != null ? Number(data.epicenterLng) : null,
=======
>>>>>>> 58fdbf595c177e942c8e1e94f609c964f5121f17
    };
  } catch (e) {
    console.warn("無法從後端取得地震資料", e);
    return null;
  }
}

<<<<<<< HEAD
export const SEVERE_EARTHQUAKE_MAGNITUDE = 5;
export const SEVERE_EARTHQUAKE_DANGER_RADIUS_KM = 100;
const SEVERE_EARTHQUAKE_RECENCY_MS = 10 * 60 * 1000;

export function isSevereNearbyEarthquake(
  alert: EarthquakeAlert,
  location: { lat: number; lng: number } | null,
) {
  if (!location || alert.epicenterLat == null || alert.epicenterLng == null) return false;
  if (alert.magnitude < SEVERE_EARTHQUAKE_MAGNITUDE) return false;
  const occurredAt = Date.parse(alert.time || alert.originTime || "");
  if (Number.isFinite(occurredAt) && Date.now() - occurredAt > SEVERE_EARTHQUAKE_RECENCY_MS) return false;
  return distanceKm(location.lat, location.lng, alert.epicenterLat, alert.epicenterLng)
    <= SEVERE_EARTHQUAKE_DANGER_RADIUS_KM;
}

=======
>>>>>>> 58fdbf595c177e942c8e1e94f609c964f5121f17
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
