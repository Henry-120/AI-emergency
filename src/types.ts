
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

// ===== BLE 藍牙通訊相關型別 =====

export type BLEConnectionState = 'disconnected' | 'connecting' | 'connected' | 'pairing_sent' | 'pairing_received';

export interface NearbyUser {
  id: string;            // BLE 裝置 ID
  nickname: string;      // 用戶暱稱
  rssi: number;          // 訊號強度
  distance: string;      // 距離估算文字 (如 "~2m")
  lastSeen: Date;        // 最後偵測時間
  connectionState: BLEConnectionState;
}

export interface BLEMessage {
  id: string;
  senderId: string;
  content: string;
  timestamp: Date;
  isMine: boolean;
}

export interface BLEState {
  isScanning: boolean;
  isAdvertising: boolean;
  isSupported: boolean;
  nearbyUsers: NearbyUser[];
  connectedUser: NearbyUser | null;
  chatMessages: BLEMessage[];
  myNickname: string;
  error: string | null;
}
