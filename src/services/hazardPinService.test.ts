import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let token: string | null = "token-1";
vi.mock("./authService", () => ({ getBackendToken: () => token }));
vi.mock("./backend", () => ({ buildBackendUrl: (path: string) => new URL(`http://api.test${path}`) }));

const { createHazardPin, deleteHazardPin, fetchNearbyHazardPins, updateHazardPin } = await import("./hazardPinService");
const { CATEGORY_COLORS, CATEGORY_LABELS, DISASTER_CATEGORIES } = await import("./disasterCategories");

const pin = {
  id: "p1",
  category: "road",
  note: "路面裂開",
  latitude: 23.97,
  longitude: 121.6,
  distance_km: null,
  created_at: "2026-10-28T10:00:00Z",
  updated_at: "2026-10-28T10:00:00Z",
  mine: true,
};

beforeEach(() => {
  token = "token-1";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastCall(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls.at(-1) as unknown as [URL, RequestInit];
  return { url: String(url), init };
}

describe("hazardPinService", () => {
  it("新增時送出分類、說明和地圖上對準的位置", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(pin), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const saved = await createHazardPin({ category: "road", note: "路面裂開", latitude: 23.97, longitude: 121.6 });
    expect(saved.id).toBe("p1");
    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("http://api.test/api/hazard-pins");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ category: "road", note: "路面裂開", latitude: 23.97, longitude: 121.6 });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-1");
  });

  it("查附近的標記帶上位置和範圍", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([pin]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchNearbyHazardPins({ lat: 23.97, lng: 121.6 }, 20);
    expect(lastCall(fetchMock).url).toBe("http://api.test/api/hazard-pins/nearby?latitude=23.97&longitude=121.6&radius_km=20");
  });

  it("修改用 PATCH，刪除成功時沒有內容", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(pin), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await updateHazardPin("p1", { category: "fire" });
    expect(lastCall(fetchMock).init.method).toBe("PATCH");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await expect(deleteHazardPin("p1")).resolves.toBeUndefined();
  });

  it("把後端說明的原因原樣告訴使用者", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "只能修改自己標記的災情" }), { status: 403 })));
    await expect(updateHazardPin("p1", { category: "fire" })).rejects.toThrow("只能修改自己標記的災情");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("oops", { status: 500 })));
    await expect(deleteHazardPin("p1")).rejects.toThrow("災情標記失敗（HTTP 500）");
  });

  it("沒登入時不送出", async () => {
    token = null;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchNearbyHazardPins({ lat: 23.97, lng: 121.6 })).rejects.toThrow("請先登入");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("disasterCategories", () => {
  it("五類都有名稱和顏色，跟郭宏的災情區域一致", () => {
    expect(DISASTER_CATEGORIES).toEqual(["road", "building", "fire", "utility", "other"]);
    expect(CATEGORY_LABELS.utility).toBe("民生設施");
    expect(CATEGORY_COLORS.fire).toBe("#ef4444");
    expect(new Set(Object.values(CATEGORY_COLORS)).size).toBe(5);
  });
});
