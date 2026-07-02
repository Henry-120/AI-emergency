
export enum DisasterType {
  EARTHQUAKE = 'EARTHQUAKE',
  FLOOD = 'FLOOD',
  FIRE = 'FIRE',
  TYPHOON = 'TYPHOON',
  LANDSLIDE = 'LANDSLIDE',
  UNKNOWN = 'UNKNOWN'
}

export interface SurvivalStep {
  title: string;
  description: string;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM';
}

export interface DisasterAnalysis {
  type: DisasterType;
  riskLevel: number; // 1-10
  situationSummary: string;
  immediateActions: SurvivalStep[];
  longTermAdvice: string;
  survivalProbability: number;
  missingInfoRequests?: string[]; // 新增：AI 認為缺少的關鍵資訊或請求
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  analysis?: DisasterAnalysis;
  timestamp: Date;
}

export interface UserStatus {
  isMoving: boolean;
  heartRate: number;
  batteryLevel: number;
  location: { lat: number; lng: number } | null;
  hasInjuries: boolean;
}

// 註冊 / 登入後的使用者資料
export interface AuthUser {
  id: string;
  username: string;
  email?: string;
  createdAt: string;
}

// 緊急醫療卡 (ICE - In Case of Emergency)
export interface MedicalCard {
  fullName: string;                  // 姓名
  birthday: string;                  // 生日 (YYYY-MM-DD)
  gender: string;                    // 性別
  bloodType: string;                 // 血型 (含 Rh)
  heightCm: string;                  // 身高 (cm)
  weightKg: string;                  // 體重 (kg)
  drugAllergies: string;             // 藥物過敏
  foodAllergies: string;             // 食物 / 其他過敏
  chronicConditions: string;         // 慢性病史
  currentMedications: string;        // 目前用藥
  medicalDevices: string;            // 體內醫療裝置 (心律調節器等)
  organDonor: boolean;               // 器官捐贈意願
  emergencyContactName: string;      // 緊急聯絡人姓名
  emergencyContactPhone: string;     // 緊急聯絡人電話
  emergencyContactRelation: string;  // 與聯絡人關係
  nationalId: string;                // 身分證 / 健保資訊
  notes: string;                     // 其他備註
  updatedAt: string;
}

export type {
  BLEConnectionState,
  BLEMessage,
  BLEState,
  NearbyUser,
} from "./types/ble";
