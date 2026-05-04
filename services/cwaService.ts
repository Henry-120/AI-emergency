const API_BASE = "https://opendata.cwa.gov.tw/api/v1/rest/datastore";
const KEY = import.meta.env.VITE_CWA_API_KEY || "";

export interface EarthquakeAlert {
  id: number;
  originTime: string;
  location: string;
  magnitude: number;
  depth: number;
  reportColor: string;
  web: string;
}

export async function fetchEarthquakes(): Promise<EarthquakeAlert[]> {
  if (!KEY) {
    console.warn("VITE_CWA_API_KEY 未設定，略過地震資料抓取");
    return [];
  }

  const urls = [
    `${API_BASE}/E-A0015-001?Authorization=${KEY}&limit=5&format=JSON`,
    `${API_BASE}/E-A0016-001?Authorization=${KEY}&limit=5&format=JSON`,
  ];

  const results = await Promise.allSettled(
    urls.map((u) => fetch(u).then((r) => r.json())),
  );

  const all: EarthquakeAlert[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const records = r.value?.records?.Earthquake || [];
    for (const eq of records) {
      all.push({
        id: eq.EarthquakeNo,
        originTime: eq.EarthquakeInfo?.OriginTime || "",
        location: eq.EarthquakeInfo?.Epicenter?.Location || "未知地點",
        magnitude: eq.EarthquakeInfo?.EarthquakeMagnitude?.MagnitudeValue ?? 0,
        depth: eq.EarthquakeInfo?.FocalDepth ?? 0,
        reportColor: eq.ReportColor || "",
        web: eq.Web || "",
      });
    }
  }

  // 依發生時間新到舊排序，去重（兩支 API 可能有重疊）
  const seen = new Set<number>();
  return all
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => b.originTime.localeCompare(a.originTime));
}
