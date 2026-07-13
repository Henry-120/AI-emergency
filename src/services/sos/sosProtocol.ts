/**
 * GuardiaAI SOS 多跳中繼 - 封包編碼與解碼
 *
 * 線路格式（明文標頭 14 bytes + 不透明內容）：
 *
 *   byte  0      version
 *   byte  1      keyVersion   後端金鑰版本
 *   byte  2      type         SOS / ALERT / ACK
 *   bytes 3–10   msgId        8 個 ASCII 字元
 *   byte  11     ttl          剩餘跳數
 *   byte  12     hops         已跳躍次數
 *   byte  13     severity     粗略嚴重程度（bitfield）
 *   bytes 14+    body         SOS/ALERT 為密文；ACK 為簽章 + 明文回執
 *
 * 標頭刻意用固定長度的二進位格式，不用 JSON：
 *   1. 省 bytes（BLE 單包空間寶貴）
 *   2. 不會因為內容含特殊字元而解析錯誤
 *   3. 中繼者能在不碰內容的前提下只讀標頭 —— 這正是信任模型的要求
 */

import {
  PacketType,
  Severity,
  type Packet,
  type PacketHeader,
} from "./sosTypes";

/** 協定版本 */
export const SOS_PROTOCOL_VERSION = 1;

/** 明文標頭長度 */
export const SOS_HEADER_BYTES = 14;

/** msgId 的字元數 */
export const MSG_ID_LENGTH = 8;

/** 預設起始 TTL：約可涵蓋 4 段接力 */
export const DEFAULT_TTL = 4;

/** TTL 上限。收到超過此值的封包視為惡意（想讓訊息無限擴散燒光所有人的電） */
export const MAX_TTL = 8;

const MSG_ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** 產生一個 msgId */
export function generateMsgId(): string {
  const out: string[] = [];
  const cryptoObj = typeof crypto !== "undefined" ? crypto : undefined;

  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(MSG_ID_LENGTH);
    cryptoObj.getRandomValues(bytes);
    for (let i = 0; i < MSG_ID_LENGTH; i++) {
      out.push(MSG_ID_ALPHABET[bytes[i] % MSG_ID_ALPHABET.length]);
    }
  } else {
    for (let i = 0; i < MSG_ID_LENGTH; i++) {
      out.push(MSG_ID_ALPHABET[Math.floor(Math.random() * MSG_ID_ALPHABET.length)]);
    }
  }

  return out.join("");
}

function isKnownType(v: number): v is PacketType {
  return v === PacketType.SOS || v === PacketType.ALERT || v === PacketType.ACK;
}

/** 把封包編碼成可傳輸的 bytes */
export function encodePacket(packet: Packet): Uint8Array {
  const { header, body } = packet;

  if (header.msgId.length !== MSG_ID_LENGTH) {
    throw new Error(`msgId 必須是 ${MSG_ID_LENGTH} 個字元`);
  }
  if (header.ttl < 0 || header.ttl > MAX_TTL) {
    throw new Error(`ttl 必須介於 0 與 ${MAX_TTL} 之間`);
  }
  if (header.hops < 0 || header.hops > 255) {
    throw new Error("hops 超出範圍");
  }

  const out = new Uint8Array(SOS_HEADER_BYTES + body.byteLength);

  out[0] = header.version;
  out[1] = header.keyVersion;
  out[2] = header.type;
  for (let i = 0; i < MSG_ID_LENGTH; i++) {
    out[3 + i] = header.msgId.charCodeAt(i);
  }
  out[11] = header.ttl;
  out[12] = header.hops;
  out[13] = header.severity;

  out.set(body, SOS_HEADER_BYTES);
  return out;
}

/**
 * 解析收到的封包。
 *
 * **來源是不可信的裝置**——任何不合法的輸入都回傳 null，絕不拋錯。
 */
export function decodePacket(bytes: Uint8Array): Packet | null {
  if (bytes.byteLength < SOS_HEADER_BYTES) return null;

  const version = bytes[0];
  if (version !== SOS_PROTOCOL_VERSION) return null;

  const type = bytes[2];
  if (!isKnownType(type)) return null;

  let msgId = "";
  for (let i = 0; i < MSG_ID_LENGTH; i++) {
    const code = bytes[3 + i];
    // msgId 必須是可列印 ASCII，否則視為損毀封包
    if (code < 0x20 || code > 0x7e) return null;
    msgId += String.fromCharCode(code);
  }

  const ttl = bytes[11];
  // 惡意端可能送出超大 TTL，讓訊息在網路裡無限擴散、燒光所有人的電池
  if (ttl > MAX_TTL) return null;

  const header: PacketHeader = {
    version,
    keyVersion: bytes[1],
    type,
    msgId,
    ttl,
    hops: bytes[12],
    severity: bytes[13],
  };

  return {
    header,
    body: new Uint8Array(bytes.subarray(SOS_HEADER_BYTES)),
  };
}

/**
 * 產生「轉發後」的封包：TTL 減 1、hops 加 1，內容原封不動。
 *
 * 中繼者不碰 body——他也解不開。
 *
 * @returns TTL 已耗盡則回傳 null（不該再轉發）
 */
export function decrementForRelay(packet: Packet): Packet | null {
  if (packet.header.ttl <= 0) return null;

  return {
    header: {
      ...packet.header,
      ttl: packet.header.ttl - 1,
      hops: Math.min(255, packet.header.hops + 1),
    },
    body: packet.body,
  };
}

/** 組一個新的 SOS/ALERT 封包標頭 */
export function createHeader(options: {
  type: PacketType;
  keyVersion: number;
  severity?: number;
  ttl?: number;
  msgId?: string;
}): PacketHeader {
  return {
    version: SOS_PROTOCOL_VERSION,
    keyVersion: options.keyVersion,
    type: options.type,
    msgId: options.msgId ?? generateMsgId(),
    ttl: options.ttl ?? DEFAULT_TTL,
    hops: 0,
    severity: options.severity ?? Severity.NONE,
  };
}

/** 把 severity bitfield 轉成人看得懂的描述（給附近的人看的，不含身分與位置） */
export function describeSeverity(severity: number): string {
  const parts: string[] = [];
  if (severity & Severity.TRAPPED) parts.push("受困");
  if (severity & Severity.INJURED) parts.push("受傷");
  if (severity & Severity.NEEDS_MEDICAL) parts.push("需要醫療協助");
  return parts.length > 0 ? parts.join("、") : "狀況不明";
}
