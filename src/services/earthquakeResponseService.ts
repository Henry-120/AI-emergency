import type { EarthquakeAlert, } from "./cwaService";
import type { EarthquakeAssessment, UserStatus } from "../types";
import { getBackendToken } from "./authService";
import { BACKEND } from "./backend";

function authorizedHeaders() {
  const token = getBackendToken();
  if (!token) throw new Error("請先登入才能建立具名的災情回報");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export async function assessEarthquakeForUser(
  alert: EarthquakeAlert,
  status: UserStatus,
  medicalSummary: string,
): Promise<EarthquakeAssessment> {
  if (!status.location || alert.epicenterLat == null || alert.epicenterLng == null) {
    throw new Error("缺少使用者或震央座標");
  }
  const response = await fetch(`${BACKEND}/api/earthquake/assess`, {
    method: "POST",
    headers: authorizedHeaders(),
    body: JSON.stringify({
      user_latitude: status.location.lat,
      user_longitude: status.location.lng,
      epicenter_latitude: alert.epicenterLat,
      epicenter_longitude: alert.epicenterLng,
      magnitude: alert.magnitude,
      location: alert.location,
      origin_time: alert.time || alert.originTime || "",
      depth: alert.depth ?? null,
      battery_level: status.batteryLevel,
      heart_rate: status.heartRate,
      medical_summary: medicalSummary,
    }),
  });
  if (!response.ok) throw new Error(`地震應變分析失敗（HTTP ${response.status}）`);
  return response.json();
}

export async function submitEarthquakeFieldReport(args: {
  assessment: EarthquakeAssessment;
  alert: EarthquakeAlert;
  status: UserStatus;
  observation: string;
}) {
  const { assessment, alert, status, observation } = args;
  if (!status.location || alert.epicenterLat == null || alert.epicenterLng == null) {
    throw new Error("缺少回報位置");
  }
  const response = await fetch(`${BACKEND}/api/earthquake/field-report`, {
    method: "POST",
    headers: authorizedHeaders(),
    body: JSON.stringify({
      earthquake_key: assessment.earthquake_key,
      user_latitude: status.location.lat,
      user_longitude: status.location.lng,
      epicenter_latitude: alert.epicenterLat,
      epicenter_longitude: alert.epicenterLng,
      magnitude: alert.magnitude,
      location: alert.location,
      distance_km: assessment.distance_km,
      is_safe: true,
      observation,
      battery_level: status.batteryLevel,
      heart_rate: status.heartRate,
      observed_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error(`災情回報失敗（HTTP ${response.status}）`);
  return response.json() as Promise<{ id: string; status: string }>;
}
