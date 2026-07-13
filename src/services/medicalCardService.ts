import { MedicalCard } from "../types";
import { BACKEND } from "./backend";
import { getCurrentUser, getBackendToken } from "./authService";

/**
 * 緊急醫療卡服務。以 localStorage 為主要儲存（離線必備），
 * 有網路時最佳努力與後端同步。每位使用者一張卡，以 user.id 區隔。
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

async function syncToBackend(card: MedicalCard) {
  const token = getBackendToken();
  if (!token) return;
  try {
    await fetch(`${BACKEND}/api/medical-card`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(toSnake(card)),
    });
  } catch {
    // 離線或後端未啟動：資料已存在本機，等下次再同步。
  }
}

export function saveMedicalCard(card: MedicalCard): MedicalCard {
  const key = cardKey();
  const saved: MedicalCard = { ...card, updatedAt: new Date().toISOString() };
  if (key) {
    localStorage.setItem(key, JSON.stringify(saved));
    void syncToBackend(saved);
  }
  return saved;
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
