const BACKEND = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

export interface EarthquakeAlert {
  id: number;
  originTime: string;
  location: string;
  magnitude: number;
  depth: number;
  epicenterLat: number | null;
  epicenterLng: number | null;
  reportColor: string;
  web: string;
}

export async function fetchEarthquakes(): Promise<EarthquakeAlert[]> {
  try {
    const res = await fetch(`${BACKEND}/api/weather/list`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn("無法從後端取得地震資料", e);
    return [];
  }
}
