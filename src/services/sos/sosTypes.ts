/**
 * GuardiaAI SOS 多跳中繼 - 型別定義
 *
 * 設計文件：docs/superpowers/specs/2026-07-13-bluetooth-sos-relay-design.md
 *
 * 核心信任模型：**中繼者是陌生人，只搬箱子不開箱。**
 * 中繼者讀得到的只有路由標頭與粗略的嚴重程度旗標；精確位置、身分、醫療摘要、
 * 求救文字全部加密，只有後端解得開。
 */

/** 封包種類 */
export enum PacketType {
  /** 求救。受困者 → 外界 */
  SOS = 1,
  /** 轉播中央氣象署警報給沒訊號的人。有網路者 → 外界 */
  ALERT = 2,
  /** 求救已成功上傳的回執。後端 → 受困者 */
  ACK = 3,
}

/**
 * 粗略的嚴重程度旗標（bitfield，1 byte）。
 *
 * 這是**唯一**放在明文裡的災情資訊：附近的人可以知道「有人有難、值得幫忙轉發」，
 * 但拿不到你是誰、你在哪、你的病史。
 */
export enum Severity {
  NONE = 0,
  /** 受困（出不去） */
  TRAPPED = 1 << 0,
  /** 受傷 */
  INJURED = 1 << 1,
  /** 需要醫療協助 */
  NEEDS_MEDICAL = 1 << 2,
}

/** 明文標頭。中繼者讀得到的全部內容。 */
export interface PacketHeader {
  /** 協定版本 */
  version: number;
  /** 後端金鑰版本。後端輪替金鑰後，舊版 App 發出的封包仍解得開 */
  keyVersion: number;
  type: PacketType;
  /** 訊息唯一識別（8 bytes），用於去重 */
  msgId: string;
  /** 剩餘跳數。每轉發一次減 1，歸零就不再轉發 */
  ttl: number;
  /** 已跳躍次數。用於在 UI 顯示「已傳到 N 跳之外」 */
  hops: number;
  /** 粗略嚴重程度（Severity 的 bitfield） */
  severity: number;
}

/** 一個完整的封包：明文標頭 + 不透明的內容 */
export interface Packet {
  header: PacketHeader;
  /**
   * 封包內容。
   *
   * SOS / ALERT：對後端公鑰加密的密文，中繼者解不開。
   * ACK：後端簽章過的明文回執（不需保密，但必須防偽）。
   */
  body: Uint8Array;
}

/**
 * SOS 的內容（加密後才送出；中繼者永遠看不到這個結構）
 */
export interface SosPayload {
  /** 發送者的本機識別碼 */
  from: string;
  /** 精確位置 */
  location?: { lat: number; lng: number };
  /** 求救文字（可由語音輸入產生） */
  text: string;
  /** 醫療摘要。只在使用者同意附帶時才有 */
  medical?: {
    bloodType?: string;
    drugAllergies?: string;
    chronicConditions?: string;
  };
  /** 裝置電量（%），供救難單位判斷這支手機還能撐多久 */
  battery?: number;
  /** 發送時間 */
  timestamp: number;
}

/** ACK 的內容（由後端簽章） */
export interface AckPayload {
  /** 這則 ACK 回應的是哪一個 SOS 的 msgId */
  refId: string;
  /** 後端收到求救的時間 */
  uploadedAt: number;
}

/**
 * 中繼者收到封包後可採取的動作。
 *
 * 抽成明確的列舉，讓轉發決策成為一個可單獨測試的純函式——
 * 這是整個中繼邏輯中最容易出錯、也最需要測試的部分。
 */
export enum RelayAction {
  /** 重複的封包，丟棄 */
  DROP_DUPLICATE = "drop_duplicate",
  /** TTL 已耗盡，不再轉發 */
  DROP_TTL_EXPIRED = "drop_ttl_expired",
  /** 電量過低，只接收不轉發（保住自己的求救能力優先） */
  DROP_LOW_BATTERY = "drop_low_battery",
  /** 我有網路 → 直接上傳後端，訊息就此離開藍牙網路 */
  UPLOAD = "upload",
  /** 沒網路 → 存入待轉發佇列，等掃到別人時傳出去 */
  RELAY = "relay",
  /** 這是回給我的 ACK → 通知使用者「求救已送出」 */
  DELIVER_ACK = "deliver_ack",
}

/** 做轉發決策時需要知道的當下狀態 */
export interface RelayContext {
  /** 本機是否有網路 */
  isOnline: boolean;
  /** 本機電量（0–100） */
  batteryLevel: number;
  /** 本機識別碼——用來判斷 ACK 是不是回給自己的 */
  localId: string;
  /** 我發出過的求救 msgId（用來比對 ACK 的 refId） */
  myPendingSosIds: Set<string>;
  /** 這個 msgId 先前是否已經看過 */
  hasSeen: (msgId: string) => boolean;
}
