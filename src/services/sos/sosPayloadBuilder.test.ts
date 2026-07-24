/**
 * sosPayloadBuilder 測試
 *
 * 驗證設計文件裡明講的規則：求救封包只帶血型、藥物過敏、慢性病三項，
 * 醫療卡其餘欄位（姓名、身分證等）一律不進封包，且由呼叫端（UI）決定
 * 這次要不要附上，不是系統自動夾帶。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCard: Record<string, unknown> = {};

vi.mock("../medicalCardService", () => ({
  getMedicalCard: () => ({
    fullName: "",
    birthday: "",
    gender: "",
    bloodType: "",
    heightCm: "",
    weightKg: "",
    drugAllergies: "",
    foodAllergies: "",
    chronicConditions: "",
    currentMedications: "",
    medicalDevices: "",
    organDonor: false,
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelation: "",
    nationalId: "",
    notes: "",
    updatedAt: "",
    ...mockCard,
  }),
}));

vi.mock("../bluetooth/bluetoothIdentity", () => ({
  getOrCreateLocalId: () => "TESTID",
}));

const { buildSosPayload } = await import("./sosPayloadBuilder");

describe("buildSosPayload", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockCard)) delete mockCard[key];
  });

  it("永遠使用持久化的本機識別碼", async () => {
    const payload = await buildSosPayload({ text: "受困於三樓" });
    expect(payload.from).toBe("TESTID");
    expect(payload.text).toBe("受困於三樓");
  });

  it("includeMedical 未指定或 false 時，不帶任何醫療欄位", async () => {
    mockCard.bloodType = "O+";
    mockCard.drugAllergies = "青黴素";

    const payload = await buildSosPayload({ text: "x", includeMedical: false });
    expect(payload.medical).toBeUndefined();
  });

  it("includeMedical=true 時，只帶血型/藥物過敏/慢性病三項，其餘醫療卡欄位不進封包", async () => {
    mockCard.bloodType = "O+";
    mockCard.drugAllergies = "青黴素";
    mockCard.chronicConditions = "氣喘";
    mockCard.fullName = "王小明"; // 姓名不該出現在求救封包裡
    mockCard.nationalId = "A123456789"; // 身分證不該出現在求救封包裡

    const payload = await buildSosPayload({ text: "x", includeMedical: true });

    expect(payload.medical).toEqual({
      bloodType: "O+",
      drugAllergies: "青黴素",
      chronicConditions: "氣喘",
    });
  });

  it("只填了部分醫療欄位時，只帶有填寫的那幾項", async () => {
    mockCard.bloodType = "AB+";

    const payload = await buildSosPayload({ text: "x", includeMedical: true });
    expect(payload.medical).toEqual({ bloodType: "AB+" });
  });

  it("醫療卡完全空白時，即使 includeMedical=true 也不帶 medical 欄位", async () => {
    const payload = await buildSosPayload({ text: "x", includeMedical: true });
    expect(payload.medical).toBeUndefined();
  });

  it("帶入呼叫端提供的位置，並附上時間戳記", async () => {
    const before = Date.now();
    const payload = await buildSosPayload({ text: "x", location: { lat: 25.03, lng: 121.56 } });

    expect(payload.location).toEqual({ lat: 25.03, lng: 121.56 });
    expect(payload.timestamp).toBeGreaterThanOrEqual(before);
  });

  it("沒有提供位置時，location 欄位為 undefined（不假造座標）", async () => {
    const payload = await buildSosPayload({ text: "x" });
    expect(payload.location).toBeUndefined();
  });
});
