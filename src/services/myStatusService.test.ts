import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let token: string | null = "token-1";
vi.mock("./authService", () => ({ getBackendToken: () => token }));
vi.mock("./backend", () => ({ BACKEND: "http://api.test" }));

const { submitMyStatus, flushPendingMyStatus } = await import("./myStatusService");
const { readPendingSelfStatus, getRememberedSelfStatus } = await import("./caseStatus");

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

const savedCase = {
  condition: "trapped",
  conditionSource: "self",
  conditionUpdatedAt: "2026-10-27T18:31:00Z",
  selfCondition: "trapped",
  selfConditionAt: "2026-10-27T18:31:00Z",
  requiresRescue: true,
  hasLocation: true,
  updatedAt: "2026-10-27T18:31:00Z",
};

const location = { lat: 23.97, lng: 121.6 };
const now = new Date("2026-10-27T18:31:00Z");

beforeEach(() => {
  token = "token-1";
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("navigator", { onLine: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("submitMyStatus", () => {
  it("線上時直接送出，帶位置和按下的時間", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(savedCase), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitMyStatus("trapped", location, now);

    expect(result).toEqual({ myCase: savedCase, queued: false });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/api/my-status");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({
      condition: "trapped",
      latitude: 23.97,
      longitude: 121.6,
      reported_at: "2026-10-27T18:31:00.000Z",
    });
    expect(readPendingSelfStatus()).toBeNull();
    expect(getRememberedSelfStatus(localStorage, now.getTime())).toBe("trapped");
  });

  it("離線時不打網路，先存在手機上", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitMyStatus("injured", location, now);

    expect(result).toEqual({ myCase: null, queued: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readPendingSelfStatus()?.condition).toBe("injured");
  });

  it("送不出去（後端錯誤、沒網路）也先存在手機上", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    expect(await submitMyStatus("safe", null, now)).toEqual({ myCase: null, queued: true });
    expect(readPendingSelfStatus()?.condition).toBe("safe");

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    expect((await submitMyStatus("trapped", null, now)).queued).toBe(true);
    expect(readPendingSelfStatus()?.condition).toBe("trapped");
  });
});

describe("flushPendingMyStatus", () => {
  it("恢復連線後補送並清掉", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    await submitMyStatus("trapped", location, now);
    vi.stubGlobal("navigator", { onLine: true });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(savedCase), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await flushPendingMyStatus()).toEqual(savedCase);
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).reported_at).toBe(
      "2026-10-27T18:31:00.000Z",
    );
    expect(readPendingSelfStatus()).toBeNull();
  });

  it("補送失敗就留著下次再試；沒登入時不送", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    await submitMyStatus("injured", location, now);
    vi.stubGlobal("navigator", { onLine: true });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    expect(await flushPendingMyStatus()).toBeNull();
    expect(readPendingSelfStatus()?.condition).toBe("injured");

    token = null;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await flushPendingMyStatus()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("沒有待送的狀態時什麼都不做", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await flushPendingMyStatus()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
