import type { EarthquakeAlert } from "./cwaService";

/** 所有模擬強震回報共用的測試事件識別碼，與正式地震 key 隔離。 */
export const SIMULATED_EARTHQUAKE_KEY = "test-simulation-earthquake-v1";

/** 回傳可直接確定的事件 key；缺少 CWA 欄位時交由呼叫端採用 hash 備援。 */
export function getEarthquakeEventKey(
  alert: Pick<EarthquakeAlert, "simulated" | "id" | "time" | "originTime">,
): string | undefined {
  if (alert.simulated) return SIMULATED_EARTHQUAKE_KEY;
  const originTime = alert.time || alert.originTime;
  if (alert.id == null || !originTime) return undefined;
  return `cwa:${String(alert.id)}:${originTime}`;
}
