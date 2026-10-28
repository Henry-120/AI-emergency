import type { EarthquakeAlert, } from "./cwaService";
import type { EarthquakeAssessment, UserStatus } from "../types";
import { getEarthquakeEventKey } from "./earthquakeEventKey";
import { getBackendToken } from "./authService";
import { BACKEND } from "./backend";

const PENDING_FIELD_REPORTS_KEY = "pending_earthquake_field_reports";

type FieldReportPayload = {
  client_report_id: string;
  earthquake_key: string;
  source_event_id?: string;
  user_latitude: number;
  user_longitude: number;
  epicenter_latitude: number;
  epicenter_longitude: number;
  magnitude: number;
  location: string;
  distance_km: number;
  is_safe: true;
  observation: string;
  battery_level: number;
  heart_rate: number;
  observed_at: string;
};

type PendingFieldReport = {
  user_id: string;
  payload: FieldReportPayload;
};

function createClientReportId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `eq-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getPendingFieldReports(): PendingFieldReport[] {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_FIELD_REPORTS_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function savePendingFieldReports(reports: PendingFieldReport[]) {
  localStorage.setItem(PENDING_FIELD_REPORTS_KEY, JSON.stringify(reports));
}

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
      source_event_id: !alert.simulated && alert.id != null ? String(alert.id) : undefined,
      depth: alert.depth ?? null,
      battery_level: status.batteryLevel,
      heart_rate: status.heartRate,
      medical_summary: medicalSummary,
    }),
  });
  if (!response.ok) throw new Error(`地震應變分析失敗（HTTP ${response.status}）`);
  const assessment = await response.json() as EarthquakeAssessment;
  const eventKey = getEarthquakeEventKey(alert);
  return eventKey ? { ...assessment, earthquake_key: eventKey } : assessment;
}

/**
 * 離線時使用與後端相同的保守門檻建立地震安全確認流程。
 * 這不是官方震度或災損預測；網路恢復後才會補上雲端在地分析。
 */
export function assessEarthquakeOffline(
  alert: EarthquakeAlert,
  status: UserStatus,
): EarthquakeAssessment | null {
  if (!status.location || alert.epicenterLat == null || alert.epicenterLng == null) return null;
  const toRadians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = toRadians(alert.epicenterLat - status.location.lat);
  const longitudeDelta = toRadians(alert.epicenterLng - status.location.lng);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(status.location.lat)) * Math.cos(toRadians(alert.epicenterLat))
    * Math.sin(longitudeDelta / 2) ** 2;
  const distance = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const impact_zone = distance <= 20 ? "epicentral"
    : distance <= 50 ? "near"
      : distance <= 100 ? "affected"
        : "distant";
  const distanceScore = impact_zone === "epicentral" ? 4
    : impact_zone === "near" ? 3
      : impact_zone === "affected" ? 2 : 1;
  const magnitudeScore = alert.magnitude >= 7 ? 3 : alert.magnitude >= 6 ? 2 : alert.magnitude >= 5 ? 1 : 0;
  const shallow = alert.depth != null && alert.depth <= 35;
  const score = distanceScore + magnitudeScore + (shallow ? 1 : 0);
  const risk_level = score >= 7 ? "critical" : score >= 5 ? "high" : score >= 3 ? "elevated" : "guarded";
  const riskLabel = { critical: "極高", high: "高", elevated: "提高", guarded: "一般警戒" }[risk_level];
  const magnitude_band = alert.magnitude >= 7 ? "極強地震" : alert.magnitude >= 6 ? "強震" : alert.magnitude >= 5 ? "顯著有感地震" : "有感地震";
  const depth_band = alert.depth == null ? "深度未提供" : alert.depth <= 35 ? "淺層地震" : alert.depth <= 70 ? "中層地震" : "較深層地震";
  const locationAction = impact_zone === "epicentral"
    ? "您位於近震央高風險區；留在掩護處，防範餘震與掉落物。"
    : impact_zone === "near"
      ? "您距震央很近；搖晃停止前勿移動，停止後避開受損外牆。"
      : impact_zone === "affected"
        ? "您在可能有感範圍；搖晃停止後檢查出口、瓦斯與電線。"
        : "您距震央較遠；保持警戒，勿為查看災情冒險移動。";
  const rawKey = `${alert.time || alert.originTime || "unknown"}-${alert.magnitude}-${alert.location}-${alert.epicenterLat}-${alert.epicenterLng}`;
  const eventKey = getEarthquakeEventKey(alert);

  return {
    earthquake_key: eventKey ?? `offline-${encodeURIComponent(rawKey).slice(0, 180)}`,
    distance_km: Math.round(distance * 10) / 10,
    impact_zone,
    risk_level,
    risk_summary: `距震央 ${distance.toFixed(1)} 公里、規模 ${alert.magnitude.toFixed(1)}（${magnitude_band}）、${depth_band}；目前應變優先級為${riskLabel}。`,
    magnitude_band,
    depth_band,
    official_tsunami_status: "unknown",
    immediate_actions: [
      "目前離線；正在搖晃時立即趴下、掩護頭頸、抓穩固定物。",
      locationAction,
      "搖晃停止後檢查自己與同伴傷勢；有立即危險請撥打 119 或 112。",
    ],
    environmental_warnings: ["海嘯官方狀態尚未確認；沿海者請留意可取得的官方廣播與地方訊息。"],
    safety_question: "目前離線安全模式：您本人與身邊的人是否安全？",
    field_report_questions: [
      "附近建物有無倒塌、裂縫或掉落物？",
      "道路、電力、瓦斯或通訊是否異常？",
      "是否有人受傷、受困或需要救援？",
    ],
  };
}

function buildFieldReportPayload(args: {
  assessment: EarthquakeAssessment;
  alert: EarthquakeAlert;
  status: UserStatus;
  observation: string;
  clientReportId?: string;
}): FieldReportPayload {
  const { assessment, alert, status, observation } = args;
  if (!status.location || alert.epicenterLat == null || alert.epicenterLng == null) {
    throw new Error("缺少回報位置");
  }
  return {
    client_report_id: args.clientReportId ?? createClientReportId(),
    earthquake_key: assessment.earthquake_key,
    source_event_id: !alert.simulated && alert.id != null ? String(alert.id) : undefined,
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
  };
}

async function postFieldReport(payload: FieldReportPayload): Promise<{ id: string; status: "received" }> {
  const response = await fetch(`${BACKEND}/api/earthquake/field-report`, {
    method: "POST",
    headers: authorizedHeaders(),
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`災情回報失敗（HTTP ${response.status}）`);
  return response.json() as Promise<{ id: string; status: "received" }>;
}

/** 離線時先留在裝置端，恢復連線後會自動送至 earthquake_field_reports。 */
export async function submitOrQueueEarthquakeFieldReport(args: {
  userId: string;
  assessment: EarthquakeAssessment;
  alert: EarthquakeAlert;
  status: UserStatus;
  observation: string;
}): Promise<{ id: string; status: "received" | "queued" }> {
  const payload = buildFieldReportPayload(args);
  if (!navigator.onLine) {
    savePendingFieldReports([...getPendingFieldReports(), { user_id: args.userId, payload }]);
    return { id: payload.client_report_id, status: "queued" };
  }
  return postFieldReport(payload);
}

/** 只同步目前登入者的待送地震回報；失敗的紀錄會留在裝置端重試。 */
export async function syncPendingEarthquakeFieldReports(userId: string) {
  if (!navigator.onLine || !getBackendToken()) return { success: false, synced: 0 };
  const pending = getPendingFieldReports();
  const remaining: PendingFieldReport[] = [];
  let synced = 0;
  for (const record of pending) {
    if (record.user_id !== userId) {
      remaining.push(record);
      continue;
    }
    try {
      await postFieldReport(record.payload);
      synced += 1;
    } catch {
      remaining.push(record);
    }
  }
  savePendingFieldReports(remaining);
  return { success: remaining.length === 0, synced };
}
