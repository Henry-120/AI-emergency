import { MedicalCard } from "../types";
import { auth, db, isFirebaseConfigured } from "./firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

/**
 * 緊急醫療卡服務。
 * - 主資料來源：Firestore（雲端、跨裝置、組員可見）。
 * - 同時在本機 localStorage 保留一份快取，讓斷網時仍可立即讀取醫療卡，
 *   並讓 AI 災害分析能同步取得摘要（災害現場必備）。
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

function uid(): string | null {
  return isFirebaseConfigured && auth.currentUser ? auth.currentUser.uid : null;
}

function cacheKey(): string | null {
  const id = uid();
  return id ? `${CARD_KEY_PREFIX}${id}` : null;
}

// ---------- 本機快取（同步） ----------
export function getMedicalCard(): MedicalCard {
  const key = cacheKey();
  if (!key) return emptyMedicalCard();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return emptyMedicalCard();
    return { ...emptyMedicalCard(), ...JSON.parse(raw) };
  } catch {
    return emptyMedicalCard();
  }
}

function writeCache(card: MedicalCard) {
  const key = cacheKey();
  if (key) localStorage.setItem(key, JSON.stringify(card));
}

export function hasMedicalCard(): boolean {
  const card = getMedicalCard();
  const { updatedAt, organDonor, ...rest } = card;
  return Object.values(rest).some((v) => String(v).trim() !== "") || organDonor;
}

// ---------- Firestore（雲端） ----------
/** 從雲端讀取醫療卡（離線時 Firestore 會自動回傳本機快取），並更新本機快取。 */
export async function fetchMedicalCard(): Promise<MedicalCard> {
  const id = uid();
  if (!id) return getMedicalCard();
  try {
    const snap = await getDoc(doc(db, "medicalCards", id));
    if (snap.exists()) {
      const card = { ...emptyMedicalCard(), ...(snap.data() as Partial<MedicalCard>) };
      writeCache(card);
      return card;
    }
  } catch {
    // 離線或讀取失敗：回傳本機快取。
  }
  return getMedicalCard();
}

/** 儲存醫療卡到雲端與本機快取。 */
export async function saveMedicalCard(card: MedicalCard): Promise<MedicalCard> {
  const saved: MedicalCard = { ...card, updatedAt: new Date().toISOString() };
  writeCache(saved);
  const id = uid();
  if (id) {
    try {
      await setDoc(
        doc(db, "medicalCards", id),
        { ...saved, ownerUid: id, serverUpdatedAt: serverTimestamp() },
        { merge: true },
      );
    } catch {
      // 離線：資料已寫入本機快取，Firestore 會在恢復連線後自動同步。
    }
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
