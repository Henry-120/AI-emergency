import { describe, expect, it } from "vitest";
import type { ChatRecord } from "./bluetooth/bluetoothTypes";
import type { NearbySosSighting } from "./sos/sosRelay";
import { buildNearbySignals, describeNearbySignal, SURVIVAL_SIGNAL_TTL_MS } from "./nearbyBluetoothSignals";

const NOW = Date.parse("2026-10-29T10:00:00Z");

function sighting(overrides: Partial<NearbySosSighting>): NearbySosSighting {
  return {
    msgId: "m1",
    fromLocalId: "AB2CD3",
    urgencyLevel: 9,
    isTrapped: true,
    location: { lat: 23.97, lng: 121.6 },
    locationDetails: "中華路 12 號 3 樓",
    hops: 2,
    firstSeenAt: NOW - 60_000,
    lastSeenAt: NOW - 30_000,
    ...overrides,
  };
}

function survival(peerId: string, minutesAgo: number, overrides: Partial<ChatRecord["message"]> = {}): ChatRecord {
  return {
    direction: "in",
    peerId,
    message: {
      from: peerId,
      text: "我在強震影響範圍內",
      kind: "survival",
      location: { lat: 23.98, lng: 121.61 },
      timestamp: NOW - minutesAgo * 60_000,
      ...overrides,
    },
  };
}

describe("buildNearbySignals", () => {
  it("只用位置和是否受困，不帶出位置描述或識別碼", () => {
    const [signal] = buildNearbySignals([sighting({})], [], NOW);
    expect(signal).toEqual({
      key: "sos:m1",
      kind: "sos",
      trapped: true,
      latitude: 23.97,
      longitude: 121.6,
      lastSeenAt: NOW - 30_000,
    });
  });

  it("沒有位置的求救不畫上地圖", () => {
    expect(buildNearbySignals([sighting({ location: undefined })], [], NOW)).toEqual([]);
  });

  it("存活訊號每人只留最新一則，太舊或不是收到的都不算", () => {
    const signals = buildNearbySignals(
      [],
      [
        survival("P1", 20),
        survival("P1", 5, { location: { lat: 1, lng: 2 } }),
        survival("P2", SURVIVAL_SIGNAL_TTL_MS / 60_000 + 1),
        { ...survival("P3", 1), direction: "out" },
        survival("P4", 1, { kind: "chat" }),
      ],
      NOW,
    );
    expect(signals.map((signal) => [signal.key, signal.latitude])).toEqual([["survival:P1", 1]]);
  });

  it("受困的求救排最前面", () => {
    const signals = buildNearbySignals(
      [sighting({ msgId: "a", isTrapped: false }), sighting({ msgId: "b", isTrapped: true })],
      [survival("P1", 1)],
      NOW,
    );
    expect(signals.map((signal) => signal.key)).toEqual(["sos:b", "sos:a", "survival:P1"]);
    expect(signals.map(describeNearbySignal)).toEqual(["藍牙求救・受困", "藍牙求救", "藍牙存活訊號"]);
  });
});
