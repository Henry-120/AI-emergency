import { BACKEND } from "./backend";

export interface Shelter {
  id: string;
  name: string;
  city?: string;
  town?: string;
  village?: string;
  address: string;
  lat: number;
  lon: number;
  open_status?: string;
  disaster_type?: string;
  capacity?: number | null;
  contact_name?: string;
  contact_phone?: string;
  last_update_time?: string;
  distance_km?: number;
  bearing_deg?: number;
}

export interface OfflineSafetyPack {
  downloaded_at: string;
  center: { lat: number; lon: number };
  radius_km: number;
  source: string;
  shelters: Shelter[];
}

const STORAGE_KEY = "offline_safety_pack";

export async function downloadOfflineSafetyPack(
  latitude: number,
  longitude: number,
  radiusKm = 10,
): Promise<{ success: boolean; pack?: OfflineSafetyPack; message: string }> {
  try {
    const url = new URL(`${BACKEND}/api/shelters/nearby`);
    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set("radius_km", String(radiusKm));

    const response = await fetch(url.toString());
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const pack: OfflineSafetyPack = {
      downloaded_at: new Date().toISOString(),
      center: data.center,
      radius_km: data.radius_km,
      source: data.source,
      shelters: data.shelters || [],
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(pack));

    return {
      success: true,
      pack,
      message: `已儲存 ${pack.shelters.length} 個附近避難所`,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "下載避難資料失敗",
    };
  }
}

export function getOfflineSafetyPack(): OfflineSafetyPack | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OfflineSafetyPack) : null;
  } catch {
    return null;
  }
}

export function saveOfflineSafetyPack(pack: OfflineSafetyPack) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pack));
}

export function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const radius = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function headingText(bearing: number) {
  if (bearing >= 337.5 || bearing < 22.5) return "北";
  if (bearing < 67.5) return "東北";
  if (bearing < 112.5) return "東";
  if (bearing < 157.5) return "東南";
  if (bearing < 202.5) return "南";
  if (bearing < 247.5) return "西南";
  if (bearing < 292.5) return "西";
  return "西北";
}

export function rankShelters(
  shelters: Shelter[],
  location: { lat: number; lng: number },
) {
  return shelters
    .map((shelter) => ({
      ...shelter,
      distance_km: distanceKm(location.lat, location.lng, shelter.lat, shelter.lon),
      bearing_deg: bearingDeg(location.lat, location.lng, shelter.lat, shelter.lon),
    }))
    .sort((a, b) => (a.distance_km || 0) - (b.distance_km || 0));
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}
