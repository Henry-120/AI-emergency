/**
 * GuardiaAI 藍牙模組 - TypeScript 型別定義
 *
 * 把所有 BLE 相關的型別集中在此檔，方便維護。
 */

/** 一筆掃到的附近 BLE 裝置（可能是同 App 用戶、也可能是其他藍牙裝置） */
export interface NearbyDevice {
  /** Capacitor 端的裝置 ID，後續連線、傳訊用 */
  deviceId: string;
  /** 廣播的 LocalName。同 App 用戶會是其 localId，其他裝置可能空白 */
  name: string;
  /**
   * 對方在廣播中宣告的 localId（短識別字串）。
   * 僅 GuardiaAI 同 App 用戶有，且要對方 App 在前景才會帶；iOS 背景時 LocalName 會被剝掉。
   * 是對話歷史的穩定 key —— 與我們收到的 IncomingMessage.from 一致。
   */
  localId?: string;
  /** 訊號強度（dBm）；數字愈大愈近（-30 很近、-90 很遠） */
  rssi: number;
  /** 是否為 GuardiaAI 同 App 用戶（廣播有我們 service UUID 即為 true） */
  isGuardiaUser: boolean;
  /** 最後一次被掃到的時間（ms） */
  lastSeenAt: number;
}

/** 傳出去的訊息 payload。透過 BLE GATT write 傳送（會被序列化成 JSON） */
export interface OutgoingMessage {
  /** 發送者的 localId */
  from: string;
  /** 訊息內容（純文字） */
  text: string;
  /** 發送者目前 GPS 位置（可選，沒網或定位失敗時可省略） */
  location?: { lat: number; lng: number };
  /** 發送時間（client 端 ms） */
  timestamp: number;
}

/** 收到的訊息（由 Swift 端 native event 推來） */
export interface IncomingMessage extends OutgoingMessage {
  /** Swift 端記錄的 Central 識別字串，可區分多個傳訊者 */
  centralId: string;
}

/** 藍牙模組整體狀態，UI 用來顯示權限/開關提示 */
export interface BluetoothStatus {
  /** 是否在原生 iOS App 內運作（false = 瀏覽器，功能受限） */
  isNative: boolean;
  /** 藍牙是否啟用（裝置藍牙開關） */
  isEnabled: boolean;
  /** 目前是否正在廣播自己 */
  isAdvertising: boolean;
  /** 目前是否正在掃描附近 */
  isScanning: boolean;
}
