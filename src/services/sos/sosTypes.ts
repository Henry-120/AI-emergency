/**
 * GuardiaAI SOS 多跳中繼 - 型別定義
 *
 * 設計文件：docs/superpowers/specs/2026-07-13-bluetooth-sos-relay-design.md
 *
 * 信任模型（v2，經產品確認調整過）：中繼者是陌生人，但**刻意讓他們看得到
 * 足夠的資訊去決定要不要直接衝過去幫忙**——緊急度、是否受困、GPS 位置、
 * 位置描述、裝置電量全部是明文。真正保留給後端／救援單位的，是身分
 * （真實姓名）、傷勢摘要、救援需求清單、行動能力、醫療病史這些更細節、
 * 更需要專業判斷或更敏感的資訊。
 *
 * 這是刻意的取捨：比起「附近的人完全看不到位置」，這個 App 判斷「讓附近
 * 願意幫忙的人能直接定位過去」的價值更高。
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

/** 明文標頭。中繼者讀得到的全部內容——見檔案開頭的信任模型說明。 */
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
  /**
   * 發送者的本機識別碼（與「附近的人」列表上顯示的是同一組）。
   *
   * 放明文是刻意的，而且**不會多洩漏任何東西**：這組識別碼本來就以 BLE
   * LocalName 的形式公開廣播，加密它並不會換到任何隱私。反而，少了它，
   * 收到求救的人無法把求救對應到眼前列表中的某個人，也就無法回訊息說
   * 「我看到了，我過去」——求救訊號等於送到了卻沒人接得上話。
   *
   * 真實姓名與傷勢細節仍然留在加密內容裡。
   */
  fromLocalId: string;
  /** 緊急度，1–10。附近的人能看到，用來判斷這是不是要立刻衝過去的等級 */
  urgencyLevel: number;
  /** 是否受困（出不去） */
  isTrapped: boolean;
  /** 發送者的裝置電量（0–100）；裝置沒回報時為 undefined */
  battery?: number;
  /** 發送者的 GPS 位置；沒有定位權限/訊號時可省略 */
  location?: { lat: number; lng: number };
  /** 位置的文字描述（例如「三樓，樓梯間」），求救當下由使用者自己填 */
  locationDetails: string;
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
 * SOS 的內容（加密後才送出；中繼者永遠看不到這個結構）。
 *
 * 位置、電量、是否受困、緊急度已經在明文標頭裡（中繼者需要看到這些才能
 * 判斷要不要直接去幫忙），這裡不重複放。留在加密內容裡的，是身分與
 * 需要專業判斷、或更敏感的資訊。
 */
export interface SosPayload {
  /** 真實姓名（登入帳號的 username）。中繼者看不到，只有後端／救援單位看得到 */
  username: string;
  /** 傷勢摘要 */
  injurySummary: string;
  /** 救援需求清單 */
  rescueNeeds: string[];
  /** 行動能力 */
  mobilityStatus: "unknown" | "mobile" | "limited" | "immobile";
  /** 醫療摘要。只在使用者同意附帶時才有 */
  medical?: {
    bloodType?: string;
    drugAllergies?: string;
    chronicConditions?: string;
  };
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
