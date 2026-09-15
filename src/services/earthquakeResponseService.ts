import { aiFetch } from "./aiDiagnostics";
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
  availableContext = "",
): Promise<EarthquakeAssessment> {
  const headers = authorizedHeaders();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 40000);
  try {
  const response = await aiFetch("earthquake", `${BACKEND}/api/earthquake/assess`, {
    signal: controller.signal,
    method: "POST",
    headers,
    body: JSON.stringify({
      user_latitude: status.location?.lat ?? null,
      user_longitude: status.location?.lng ?? null,
      epicenter_latitude: alert.epicenterLat,
      epicenter_longitude: alert.epicenterLng,
      magnitude: alert.magnitude,
      location: alert.location,
      origin_time: alert.time || alert.originTime || "",
      depth: alert.depth ?? null,
      battery_level: status.batteryLevel,
      heart_rate: status.heartRate,
      medical_summary: medicalSummary,
      available_context: availableContext.slice(-6000),
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(response.status === 401 ? "登入已過期，請重新線上登入後再試" :
      typeof body?.detail === "string" ? body.detail : `地震應變分析失敗（HTTP ${response.status}）`);
  }
  return await response.json();
  } catch (error) {
    if (controller.signal.aborted) throw new Error("地震應變分析逾時，請稍後再試");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function submitEarthquakeFieldReport(args: {
  assessment: EarthquakeAssessment;
  alert: EarthquakeAlert;
  status: UserStatus;
  observation: string;
}) {
  const { assessment, alert, status, observation } = args;
  if (!status.location || alert.epicenterLat == null || alert.epicenterLng == null || assessment.distance_km == null) {
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
