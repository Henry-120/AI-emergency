import { describe, expect, it } from "vitest";
import {
  getRememberedSelfStatus,
  NEED_HELP_OPTIONS,
  needsRescue,
  readPendingSelfStatus,
  rememberSelfStatus,
  savePendingSelfStatus,
  SELF_STATUS_OPTIONS,
  STATUS_META,
  statusFromQuickReply,
} from "./caseStatus";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
  };
}

describe("狀態定義", () => {
  it("嚴重程度跟後端 case_status.py 的 SEVERITY 一致", () => {
    expect(Object.fromEntries(Object.entries(STATUS_META).map(([key, meta]) => [key, meta.severity]))).toEqual({
      trapped: 3,
      injured: 2,
      need_help: 2,
      need_supplies: 1,
      safe: 0,
      helping: 0,
    });
  });

  it("每種狀態都有不同的文字，受困、受傷、物資的形狀也不同", () => {
    const labels = SELF_STATUS_OPTIONS.map((status) => STATUS_META[status].label);
    expect(new Set(labels).size).toBe(labels.length);
    const shapes = NEED_HELP_OPTIONS.map((status) => STATUS_META[status].glyph);
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it("哪些狀態需要救援", () => {
    expect(needsRescue("trapped")).toBe(true);
    expect(needsRescue("need_help")).toBe(true);
    expect(needsRescue("need_supplies")).toBe(true);
    expect(needsRescue("safe")).toBe(false);
    expect(needsRescue("helping")).toBe(false);
    expect(needsRescue(null)).toBe(false);
  });
});

describe("statusFromQuickReply", () => {
  it("認得狀態按鈕和安全確認的按鈕", () => {
    expect(statusFromQuickReply("受困，無法移動")).toBe("trapped");
    expect(statusFromQuickReply("安全，需要物資")).toBe("need_supplies");
    expect(statusFromQuickReply("我目前安全")).toBe("safe");
    expect(statusFromQuickReply(" 我人安全 ")).toBe("safe");
  });

  it("不猜自由輸入的句子", () => {
    expect(statusFromQuickReply("我不確定自己安不安全")).toBeNull();
    expect(statusFromQuickReply("我需要協助")).toBeNull();
    expect(statusFromQuickReply("受困")).toBeNull();
  });
});

describe("手機上記住的狀態", () => {
  it("24 小時內的狀態會帶給藍牙求救，太舊的就不帶", () => {
    const storage = memoryStorage();
    const at = "2026-10-28T02:31:00Z";
    rememberSelfStatus("trapped", at, storage);
    expect(getRememberedSelfStatus(storage, Date.parse(at) + 60_000)).toBe("trapped");
    expect(getRememberedSelfStatus(storage, Date.parse(at) + 25 * 60 * 60 * 1000)).toBeNull();
  });

  it("待送的狀態只留最新一筆，可以清掉", () => {
    const storage = memoryStorage();
    savePendingSelfStatus({ condition: "injured", latitude: 23.9, longitude: 121.6, reported_at: "a" }, storage);
    savePendingSelfStatus({ condition: "trapped", latitude: null, longitude: null, reported_at: "b" }, storage);
    expect(readPendingSelfStatus(storage)?.condition).toBe("trapped");
    savePendingSelfStatus(null, storage);
    expect(readPendingSelfStatus(storage)).toBeNull();
  });

  it("壞掉或不認得的資料當作沒有", () => {
    const storage = memoryStorage();
    storage.setItem("guardia:pending-self-status", "{壞掉");
    expect(readPendingSelfStatus(storage)).toBeNull();
    storage.setItem("guardia:self-status", JSON.stringify({ status: "flying", at: "2026-10-28T02:31:00Z" }));
    expect(getRememberedSelfStatus(storage)).toBeNull();
    expect(readPendingSelfStatus(null)).toBeNull();
  });
});
