/**
 * sosPayloadBuilder 測試
 *
 * 驗證設計文件裡明講的規則：求救封包（加密段）只帶血型、藥物過敏、慢性病
 * 三項，醫療卡其餘欄位（生日、身分證等）一律不進封包，且由呼叫端（UI）
 * 決定這次要不要附上，不是系統自動夾帶。
 *
 * 緊急度、是否受困、GPS 位置、位置描述、裝置電量已經搬到明文標頭
 * （見 sosProtocol.ts createHeader），不是這個檔案的職責。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCard: Record<string, unknown> = {};
let mockUser: { username: string } | null = { username: "王小明" };

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

vi.mock("../authService", () => ({
  getCurrentUser: () => mockUser,
}));

const { buildSosPayload } = await import("./sosPayloadBuilder");

const baseOptions = {
  injurySummary: "右腳受傷無法行走",
  rescueNeeds: ["醫療協助"],
  mobilityStatus: "immobile" as const,
};

describe("buildSosPayload", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockCard)) delete mockCard[key];
    mockUser = { username: "王小明" };
  });

  it("帶入登入帳號的真實姓名與表單填寫的內容", () => {
    const payload = buildSosPayload(baseOptions);
    expect(payload.username).toBe("王小明");
    expect(payload.injurySummary).toBe("右腳受傷無法行走");
    expect(payload.rescueNeeds).toEqual(["醫療協助"]);
    expect(payload.mobilityStatus).toBe("immobile");
  });

  it("沒有登入時，username 給一個明確的預設值而非 undefined", () => {
    mockUser = null;
    const payload = buildSosPayload(baseOptions);
    expect(payload.username).toBe("未知使用者");
  });

  it("includeMedical 未指定或 false 時，不帶任何醫療欄位", () => {
    mockCard.bloodType = "O+";
    mockCard.drugAllergies = "青黴素";

    const payload = buildSosPayload({ ...baseOptions, includeMedical: false });
    expect(payload.medical).toBeUndefined();
  });

  it("includeMedical=true 時，只帶血型/藥物過敏/慢性病三項，其餘醫療卡欄位不進封包", () => {
    mockCard.bloodType = "O+";
    mockCard.drugAllergies = "青黴素";
    mockCard.chronicConditions = "氣喘";
    mockCard.fullName = "李大華"; // 醫療卡上的姓名不該混進來（真實姓名是走 username）
    mockCard.nationalId = "A123456789"; // 身分證不該出現在求救封包裡

    const payload = buildSosPayload({ ...baseOptions, includeMedical: true });

    expect(payload.medical).toEqual({
      bloodType: "O+",
      drugAllergies: "青黴素",
      chronicConditions: "氣喘",
    });
  });

  it("只填了部分醫療欄位時，只帶有填寫的那幾項", () => {
    mockCard.bloodType = "AB+";

    const payload = buildSosPayload({ ...baseOptions, includeMedical: true });
    expect(payload.medical).toEqual({ bloodType: "AB+" });
  });

  it("醫療卡完全空白時，即使 includeMedical=true 也不帶 medical 欄位", () => {
    const payload = buildSosPayload({ ...baseOptions, includeMedical: true });
    expect(payload.medical).toBeUndefined();
  });

  it("附上時間戳記", () => {
    const before = Date.now();
    const payload = buildSosPayload(baseOptions);
    expect(payload.timestamp).toBeGreaterThanOrEqual(before);
  });
});
