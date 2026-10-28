import { BACKEND, buildBackendUrl } from "./backend";
import { getBackendToken } from "./authService";

export interface RescueCase {
  caseId: string;
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
  status: string;
}

export interface FieldReport {
  id: string;
  earthquake_key: string;
  source_event_id?: string;
  origin_time?: string;
  epicenter_latitude?: number;
  epicenter_longitude?: number;
  user_latitude: number;
  user_longitude: number;
  magnitude: number;
  location: string;
  distance_km: number;
  observation: string;
  observed_at?: string;
  server_timestamp?: string;
  status: string;
  links?: RescueReportLink[];
}

export interface RescueReportLink {
  id: string;
  target_type: "site" | "case";
  target_id: string;
  target_label: string;
  note: string;
}

export interface PersonRescueCase {
  id: string;
  label: string;
  situation_summary: string;
  earthquake_key: string;
  incident_id?: string;
  site_id?: string;
  latitude: number;
  longitude: number;
  priority: number;
  status: string;
  status_history?: PersonRescueCaseStatusHistoryEntry[];
}

export interface PersonRescueCaseStatusHistoryEntry {
  from_status?: string | null;
  to_status: string;
  updated_by: string;
  updated_at: string;
  reason?: string;
  mission_id?: string;
}

export interface RescueMission {
  id: string;
  case_id: string;
  title: string;
  team_id?: string;
  team_name: string;
  case_label?: string;
  case_summary?: string;
  instructions: string;
  earthquake_key: string;
  incident_id?: string;
  site_id?: string;
  latitude: number;
  longitude: number;
  status: string;
  created_by: string;
  assigned_at: string;
  created_at: string;
  updated_at: string;
  status_history?: { from_status: string; to_status: string; updated_by: string; updated_at: string; note?: string }[];
}

export interface RescueTeam {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  member_count: number;
}

export interface RescueTeamCreated extends RescueTeam {
  join_code: string;
}

export interface RescueTeamMember {
  id: string;
  username: string;
  email?: string;
  created_at: string;
  role: "field";
}

export interface RescueSite {
  id: string;
  title: string;
  description: string;
  earthquake_key: string;
  incident_id?: string;
  latitude: number;
  longitude: number;
  status: string;
}

export interface RescueIncident {
  id: string;
  title: string;
  event_keys: string[];
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface FieldSummary {
  summary: string;
  key_findings: string[];
  uncertainties: string[];
  report_count: number;
  source_ids: string[];
  source_refs: { number: number; id: string; observed_at: string; location: string }[];
  generated_at: string;
}

async function rescueRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getBackendToken();
  if (!token) throw new Error("請重新登入救援人員帳號");
  const response = await fetch(`${BACKEND}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail || `救援資料載入失敗（HTTP ${response.status}）`);
  }
  return response.json() as Promise<T>;
}

export const fetchFieldReports = (limit = 200, incidentId?: string) => {
  const query = new URLSearchParams({ limit: String(limit) });
  if (incidentId) query.set("incident_id", incidentId);
  return rescueRequest<FieldReport[]>(`/api/rescue/field-reports?${query.toString()}`);
};
export const fetchFieldSummary = (earthquakeKey?: string, incidentId?: string) => {
  const query = new URLSearchParams();
  if (earthquakeKey) query.set("earthquake_key", earthquakeKey);
  if (incidentId) query.set("incident_id", incidentId);
  return rescueRequest<FieldSummary>(`/api/rescue/field-summary?${query.toString()}`, { method: "GET" });
};
export const fetchRescueIncidents = () => rescueRequest<RescueIncident[]>("/api/rescue/incidents");
export const createRescueIncident = (title: string, earthquakeKey: string) =>
  rescueRequest<RescueIncident>("/api/rescue/incidents", {
    method: "POST",
    body: JSON.stringify({ title, earthquake_key: earthquakeKey }),
  });
export const addEventToRescueIncident = (incidentId: string, earthquakeKey: string) =>
  rescueRequest<RescueIncident>(`/api/rescue/incidents/${encodeURIComponent(incidentId)}/events`, {
    method: "POST",
    body: JSON.stringify({ earthquake_key: earthquakeKey }),
  });
export const fetchPersonRescueCases = () => rescueRequest<PersonRescueCase[]>("/api/rescue/person-cases");
export const fetchRescueMissions = (caseId?: string) => {
  const query = new URLSearchParams();
  if (caseId) query.set("case_id", caseId);
  const suffix = query.toString();
  return rescueRequest<RescueMission[]>(`/api/rescue/missions${suffix ? `?${suffix}` : ""}`);
};
export const createRescueMission = (data: { case_id: string; title: string; team_id: string; instructions: string }) =>
  rescueRequest<RescueMission>("/api/rescue/missions", { method: "POST", body: JSON.stringify(data) });
export const fetchRescueTeams = () => rescueRequest<RescueTeam[]>("/api/rescue/teams");
export const createRescueTeam = (name: string) => rescueRequest<RescueTeamCreated>("/api/rescue/teams", {
  method: "POST", body: JSON.stringify({ name }),
});
export const fetchRescueTeamMembers = (teamId: string) =>
  rescueRequest<RescueTeamMember[]>(`/api/rescue/teams/${encodeURIComponent(teamId)}/members`);
export const fetchFieldTeam = () => rescueRequest<RescueTeam>("/api/field/team");
export const fetchFieldMissions = () => rescueRequest<RescueMission[]>("/api/field/missions");
export const updateFieldMissionStatus = (missionId: string, status: string, note = "") =>
  rescueRequest<RescueMission>(`/api/field/missions/${encodeURIComponent(missionId)}/status`, {
    method: "POST", body: JSON.stringify({ status, note }),
  });
export const updatePersonRescueCaseStatus = (caseId: string, status: string) =>
  rescueRequest<PersonRescueCase>(`/api/rescue/person-cases/${encodeURIComponent(caseId)}/status`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
export const fetchNearbyPersonRescueCases = (location: { lat: number; lng: number }, radiusKm = 50) => {
  const query = new URLSearchParams({ latitude: String(location.lat), longitude: String(location.lng), radius_km: String(radiusKm) });
  return rescueRequest<PersonRescueCase[]>(`/api/rescue/person-cases/nearby?${query.toString()}`);
};
export const fetchRescueSites = () => rescueRequest<RescueSite[]>("/api/rescue/sites");
export const createPersonRescueCaseFromReport = (
  reportId: string,
  data: { label: string; situation_summary: string; priority: number; site_id?: string; incident_id?: string },
) => rescueRequest<PersonRescueCase>(`/api/rescue/field-reports/${encodeURIComponent(reportId)}/person-cases`, {
  method: "POST",
  body: JSON.stringify(data),
});
export const createRescueSiteFromReport = (
  reportId: string,
  data: { title: string; description: string; incident_id?: string },
) => rescueRequest<RescueSite>(`/api/rescue/field-reports/${encodeURIComponent(reportId)}/sites`, {
  method: "POST",
  body: JSON.stringify(data),
});
export const linkFieldReport = (
  reportId: string,
  targetType: "site" | "case",
  targetId: string,
  note = "",
) => rescueRequest<RescueReportLink>(`/api/rescue/field-reports/${encodeURIComponent(reportId)}/links`, {
  method: "POST",
  body: JSON.stringify({ target_type: targetType, target_id: targetId, note }),
});
export const updateRescueStatus = (kind: "cases" | "field-reports" | "sos", id: string, status: string) =>
  rescueRequest<{ status: string }>(`/api/rescue/${kind}/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ status }) });

export async function fetchNearbyRescueCases(
  location: { lat: number; lng: number },
  radiusKm = 50,
): Promise<RescueCase[]> {
  const token = getBackendToken();
  if (!token) throw new Error("缺少救援地圖登入憑證，請重新登入");
  const url = buildBackendUrl("/api/rescue/nearby");
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
  status: string;
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
  rescue_status: string;
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
    status: item.rescue_status,
  };
}

export async function fetchNearbySosReports(
  location: { lat: number; lng: number },
  radiusKm = 50,
): Promise<SosCase[]> {
  const token = getBackendToken();
  if (!token) throw new Error("缺少救援地圖登入憑證，請重新登入");
  const url = buildBackendUrl("/api/sos/nearby");
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
