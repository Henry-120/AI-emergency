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

/**
 * 透過藍牙多跳中繼送達的求救記錄。
 *
 * 跟 RescueCase 是不同的資料來源，但欄位刻意對齊，方便同一個畫面呈現兩種
 * 案件：緊急度/是否受困/位置/位置描述/電量來自封包明文標頭（中繼的陌生人
 * 也看得到）；使用者名稱/傷勢摘要/救援需求/行動能力/醫療摘要來自加密內容
 * （只有救援端解得開，見 sosPayloadBuilder.ts）。fromLocalId 是「附近的人」
 * 共用的短識別碼，不是帳號。
 */
export interface SosCase {
  msgId: string;
  hops: number;
  urgencyLevel: number;
  isTrapped: boolean;
  latitude: number;
  longitude: number;
  distanceKm: number;
  locationDetails: string;
  batteryLevel: number | null;
  fromLocalId: string;
  username: string;
  injurySummary: string;
  rescueNeeds: string[];
  mobilityStatus: string;
  bloodType: string;
  drugAllergies: string;
  chronicConditions: string;
  receivedAt: string;
}

interface SosCaseApiResponse {
  msg_id: string;
  hops: number;
  urgency_level: number;
  is_trapped: boolean;
  latitude: number;
  longitude: number;
  distanceKm: number;
  location_details: string;
  battery_level: number | null;
  from_local_id: string;
  username: string;
  injury_summary: string;
  rescue_needs: string[];
  mobility_status: string;
  blood_type: string;
  drug_allergies: string;
  chronic_conditions: string;
  received_at: string;
}

function fromSosApiResponse(item: SosCaseApiResponse): SosCase {
  return {
    msgId: item.msg_id,
    hops: item.hops,
    urgencyLevel: item.urgency_level,
    isTrapped: item.is_trapped,
    latitude: item.latitude,
    longitude: item.longitude,
    distanceKm: item.distanceKm,
    locationDetails: item.location_details,
    batteryLevel: item.battery_level,
    fromLocalId: item.from_local_id,
    username: item.username,
    injurySummary: item.injury_summary,
    rescueNeeds: item.rescue_needs,
    mobilityStatus: item.mobility_status,
    bloodType: item.blood_type,
    drugAllergies: item.drug_allergies,
    chronicConditions: item.chronic_conditions,
    receivedAt: item.received_at,
  };
}

export async function fetchNearbySosReports(
  location: { lat: number; lng: number },
  radiusKm = 50,
): Promise<SosCase[]> {
  const token = getBackendToken();
  if (!token) throw new Error("缺少救援地圖登入憑證，請重新登入");
  const url = new URL(`${BACKEND}/api/sos/nearby`);
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
    if (!response.ok) throw new Error(`求救記錄載入失敗（HTTP ${response.status}）`);
    const data = (await response.json()) as SosCaseApiResponse[];
    return data.map(fromSosApiResponse);
  } finally {
    window.clearTimeout(timeout);
  }
}
