import { MedicalCard } from "../types";
import { BACKEND } from "./backend";
import { getCurrentUser, getBackendToken } from "./authService";

/**
 * 緊急醫療卡服務。線上時以後端為準，離線時才使用 localStorage 快取。
 * 每位使用者一張卡，以 user.id 區隔。
 */

const CARD_KEY_PREFIX = "guardia_medical_card_";

export function emptyMedicalCard(): MedicalCard {
  return {
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
  };
}

function cardKey(): string | null {
  const user = getCurrentUser();
  return user ? `${CARD_KEY_PREFIX}${user.id}` : null;
}

export function getMedicalCard(): MedicalCard {
  const key = cardKey();
  if (!key) return emptyMedicalCard();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return emptyMedicalCard();
    return { ...emptyMedicalCard(), ...JSON.parse(raw) };
  } catch {
    return emptyMedicalCard();
  }
}

/** 醫療卡是否已填寫過任何欄位。 */
export function hasMedicalCard(): boolean {
  const card = getMedicalCard();
  const { updatedAt, organDonor, ...rest } = card;
  return Object.values(rest).some((v) => String(v).trim() !== "") || organDonor;
}

// camelCase <-> snake_case 轉換 (後端使用 snake_case)
function toSnake(card: MedicalCard): Record<string, any> {
  return {
    full_name: card.fullName,
    birthday: card.birthday,
    gender: card.gender,
    blood_type: card.bloodType,
    height_cm: card.heightCm,
    weight_kg: card.weightKg,
    drug_allergies: card.drugAllergies,
    food_allergies: card.foodAllergies,
    chronic_conditions: card.chronicConditions,
    current_medications: card.currentMedications,
    medical_devices: card.medicalDevices,
    organ_donor: card.organDonor,
    emergency_contact_name: card.emergencyContactName,
    emergency_contact_phone: card.emergencyContactPhone,
    emergency_contact_relation: card.emergencyContactRelation,
    national_id: card.nationalId,
    notes: card.notes,
  };
}

function fromSnake(data: Record<string, any>): MedicalCard {
  return {
    fullName: data.full_name || "",
    birthday: data.birthday || "",
    gender: data.gender || "",
    bloodType: data.blood_type || "",
    heightCm: data.height_cm || "",
    weightKg: data.weight_kg || "",
    drugAllergies: data.drug_allergies || "",
    foodAllergies: data.food_allergies || "",
    chronicConditions: data.chronic_conditions || "",
    currentMedications: data.current_medications || "",
    medicalDevices: data.medical_devices || "",
    organDonor: Boolean(data.organ_donor),
    emergencyContactName: data.emergency_contact_name || "",
    emergencyContactPhone: data.emergency_contact_phone || "",
    emergencyContactRelation: data.emergency_contact_relation || "",
    nationalId: data.national_id || "",
    notes: data.notes || "",
    updatedAt: data.updated_at || "",
  };
}

function cacheMedicalCard(card: MedicalCard) {
  const key = cardKey();
  if (key) localStorage.setItem(key, JSON.stringify(card));
}

async function backendRequest(path: string, init: RequestInit = {}) {
  const token = getBackendToken();
  if (!token) throw new Error("缺少線上登入憑證，請重新登入");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${BACKEND}${path}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`線上醫療卡操作失敗（HTTP ${response.status}）`);
    return response;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function loadMedicalCard(): Promise<MedicalCard> {
  if (!navigator.onLine) return getMedicalCard();
  const response = await backendRequest("/api/medical-card");
  const card = fromSnake(await response.json());
  cacheMedicalCard(card);
  return card;
}

export async function saveMedicalCard(card: MedicalCard): Promise<MedicalCard> {
  const saved: MedicalCard = { ...card, updatedAt: new Date().toISOString() };
  if (!navigator.onLine) {
    cacheMedicalCard(saved);
    return saved;
  }

  const response = await backendRequest("/api/medical-card", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toSnake(saved)),
  });
  const onlineCard = fromSnake(await response.json());
  cacheMedicalCard(onlineCard);
  return onlineCard;
}

/**
 * 將醫療卡摘要為一段文字，供 AI 災害分析參考（僅納入已填寫欄位）。
 */
export function summarizeMedicalCard(card: MedicalCard): string {
  const parts: string[] = [];
  if (card.bloodType) parts.push(`血型 ${card.bloodType}`);
  if (card.birthday) parts.push(`生日 ${card.birthday}`);
  if (card.gender) parts.push(`性別 ${card.gender}`);
  if (card.drugAllergies) parts.push(`藥物過敏：${card.drugAllergies}`);
  if (card.foodAllergies) parts.push(`其他過敏：${card.foodAllergies}`);
  if (card.chronicConditions) parts.push(`慢性病史：${card.chronicConditions}`);
  if (card.currentMedications) parts.push(`目前用藥：${card.currentMedications}`);
  if (card.medicalDevices) parts.push(`體內醫療裝置：${card.medicalDevices}`);
  if (card.emergencyContactName)
    parts.push(
      `緊急聯絡人：${card.emergencyContactName}` +
        (card.emergencyContactPhone ? ` (${card.emergencyContactPhone})` : ""),
    );
  return parts.length ? parts.join("；") : "";
}
