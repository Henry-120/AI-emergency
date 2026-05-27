
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
  imageBase64?: string | null; // 新增這一行，讓 ChatMessage 能夠合法攜帶圖片資料！
}

export interface UserStatus {
  isMoving: boolean;
  heartRate: number;
  batteryLevel: number;
  location: { lat: number; lng: number } | null;
  hasInjuries: boolean;
}

export type {
  BLEConnectionState,
  BLEMessage,
  BLEState,
  NearbyUser,
} from "./types/ble";
