import { BACKEND } from "./backend";

export interface EarthquakeAlert {
  magnitude: number;
  location: string;
  time: string;
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
    };
  } catch (e) {
    console.warn("無法從後端取得地震資料", e);
    return null;
  }
}
