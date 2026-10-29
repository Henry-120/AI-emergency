import type { ChatRecord } from "./bluetooth/bluetoothTypes";
import type { NearbySosSighting } from "./sos/sosRelay";

/**
 * 一般使用者地圖上的「附近的人」：只有這支手機用藍牙實際收到的訊號才會出現。
 * 沒有藍牙接觸就看不到任何其他人，遠方的陌生人也看不到你。
 *
 * 只用明文就看得到的資訊（位置、是否受困）；姓名、位置描述、傷勢、醫療資料都不顯示。
 * 資料全部在手機本機，斷網也能用。
 */
export interface NearbySignal {
  key: string;
  kind: "sos" | "survival";
  trapped: boolean;
  latitude: number;
  longitude: number;
  /** 最後一次收到的時間（毫秒） */
  lastSeenAt: number;
}

/** 存活訊號多久沒再收到就不顯示。求救目擊記錄由 sosRelay 自己管理過期（5 分鐘）。 */
export const SURVIVAL_SIGNAL_TTL_MS = 30 * 60_000;

export function buildNearbySignals(
  sightings: NearbySosSighting[],
  records: ChatRecord[],
  now = Date.now(),
): NearbySignal[] {
  const signals: NearbySignal[] = [];
  for (const sighting of sightings) {
    if (!sighting.location) continue;
    signals.push({
      key: `sos:${sighting.msgId}`,
      kind: "sos",
      trapped: sighting.isTrapped,
      latitude: sighting.location.lat,
      longitude: sighting.location.lng,
      lastSeenAt: sighting.lastSeenAt,
    });
  }
  // 存活訊號：每個人只留最新一則，太舊的不顯示。
  const latestSurvival = new Map<string, ChatRecord>();
  for (const record of records) {
    const { message } = record;
    if (record.direction !== "in" || message.kind !== "survival" || !message.location) continue;
    if (now - message.timestamp > SURVIVAL_SIGNAL_TTL_MS) continue;
    const previous = latestSurvival.get(record.peerId);
    if (!previous || previous.message.timestamp < message.timestamp) latestSurvival.set(record.peerId, record);
  }
  for (const [peerId, record] of latestSurvival) {
    const location = record.message.location!;
    signals.push({
      key: `survival:${peerId}`,
      kind: "survival",
      trapped: false,
      latitude: location.lat,
      longitude: location.lng,
      lastSeenAt: record.message.timestamp,
    });
  }
  // 受困的求救排最前面。
  return signals.sort((a, b) => Number(b.kind === "sos" && b.trapped) - Number(a.kind === "sos" && a.trapped)
    || Number(b.kind === "sos") - Number(a.kind === "sos")
    || b.lastSeenAt - a.lastSeenAt);
}

export function describeNearbySignal(signal: NearbySignal): string {
  if (signal.kind === "survival") return "藍牙存活訊號";
  return signal.trapped ? "藍牙求救・受困" : "藍牙求救";
}
