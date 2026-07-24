import { BACKEND } from "./backend";
import { getBackendToken } from "./authService";

export interface RescueCase {
  userId: string;
  username: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  urgencyLevel: number;
  injurySeverity: string;
  injurySummary: string;
  rescueNeeds: string[];
  isTrapped: boolean;
  mobilityStatus: string;
  locationDetails: string;
  updatedAt: string;
}

export async function fetchNearbyRescueCases(
  location: { lat: number; lng: number },
  radiusKm = 50,
): Promise<RescueCase[]> {
  const token = getBackendToken();
  if (!token) throw new Error("缺少救援地圖登入憑證，請重新登入");
  const url = new URL(`${BACKEND}/api/rescue/nearby`);
  url.searchParams.set("latitude", String(location.lat));
  url.searchParams.set("longitude", String(location.lng));
  url.searchParams.set("radius_km", String(radiusKm));
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`救援案件載入失敗（HTTP ${response.status}）`);
    return response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}
