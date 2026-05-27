export type BLEConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "pairing_sent"
  | "pairing_received";

export interface NearbyUser {
  id: string;
  nickname: string;
  rssi: number;
  distance: string;
  lastSeen: Date;
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
