
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

export type RoomRiskZoneType = 'danger' | 'caution' | 'safe';
export type RoomRiskObjectLevel = 'high' | 'medium' | 'low';
export type RoomRiskImpactType =
  | 'topple'
  | 'falling'
  | 'glass'
  | 'blocked_path'
  | 'safe_floor';

export interface RoomRiskPoint {
  x: number;
  y: number;
}

export interface RoomRiskZone {
  id: string;
  type: RoomRiskZoneType;
  impactType: RoomRiskImpactType;
  label: string;
  reason: string;
  sourceObjectLabel?: string;
  polygon: RoomRiskPoint[];
}

export interface RoomRiskObject {
  label: string;
  risk: RoomRiskObjectLevel;
  reason: string;
  recommendation: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface RoomRiskAnalysis {
  summary: string;
  overallRiskLevel: number;
  objects: RoomRiskObject[];
  zones: RoomRiskZone[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  analysis?: DisasterAnalysis;
  roomRiskAnalysis?: RoomRiskAnalysis;
  timestamp: Date;
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
