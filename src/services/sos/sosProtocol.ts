/**
 * GuardiaAI SOS 多跳中繼 - 封包編碼與解碼
 *
 * 線路格式（明文標頭 33 bytes 固定 + 位置描述變長段 + 不透明內容）：
 *
 *   byte  0        version
 *   byte  1        keyVersion       後端金鑰版本
 *   byte  2        type             SOS / ALERT / ACK
 *   bytes 3–10     msgId            8 個 ASCII 字元
 *   byte  11       ttl              剩餘跳數
 *   byte  12       hops             已跳躍次數
 *   byte  13       urgencyLevel     緊急度 0–10
 *   byte  14       flags            bit0=isTrapped bit1=hasLocation bit2=hasBattery
 *   byte  15       battery          0–100；flags 未設 hasBattery 時無意義
 *   bytes 16–19    latitude         float32（big-endian）；flags 未設 hasLocation 時無意義
 *   bytes 20–23    longitude        float32（big-endian）
 *   bytes 24–31    fromLocalId      發送者識別碼，8 bytes ASCII，不足補 \0
 *   byte  32       locationDetailsLen  位置描述的 byte 長度（0–255）
 *   bytes 33+      locationDetails  UTF-8，長度為上一個 byte 的值
 *   bytes 之後      body             SOS/ALERT 為密文；ACK 為簽章 + 明文回執
 *
 * 標頭刻意用固定＋長度前綴的二進位格式，不用 JSON：
 *   1. 省 bytes（BLE 單包空間寶貴）
 *   2. 不會因為內容含特殊字元而解析錯誤
 *   3. 中繼者能在不碰內容的前提下只讀標頭 —— 這正是信任模型的要求
 *
 * v2 變更：緊急度、是否受困、GPS 位置、位置描述、裝置電量全部搬到明文標頭
 * ——這是產品面刻意的選擇，讓附近願意幫忙的陌生人能直接看到、直接定位過去。
 * v3 變更：發送者識別碼（fromLocalId）也移到明文標頭。它本來就以 BLE LocalName
 * 公開廣播，加密它換不到任何隱私，卻讓收到求救的人無法對應到眼前的人、無法回話。
 * 見 sosTypes.ts 開頭的信任模型說明。
 */

import {
  PacketType,
  type Packet,
  type PacketHeader,
} from "./sosTypes";

/** 協定版本 */
export const SOS_PROTOCOL_VERSION = 3;

/** 明文標頭固定長度（不含變長的 locationDetails） */
export const SOS_HEADER_FIXED_BYTES = 33;

/** fromLocalId 在標頭裡佔的固定 byte 數，不足補 \0 */
export const FROM_LOCAL_ID_BYTES = 8;

/** msgId 的字元數 */
export const MSG_ID_LENGTH = 8;

/** 位置描述的最大 byte 長度 */
export const MAX_LOCATION_DETAILS_BYTES = 120;

/** 預設起始 TTL：約可涵蓋 4 段接力 */
export const DEFAULT_TTL = 4;

/** TTL 上限。收到超過此值的封包視為惡意（想讓訊息無限擴散燒光所有人的電） */
export const MAX_TTL = 8;

const FLAG_IS_TRAPPED = 1 << 0;
const FLAG_HAS_LOCATION = 1 << 1;
const FLAG_HAS_BATTERY = 1 << 2;

const MSG_ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

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
  if (header.urgencyLevel < 0 || header.urgencyLevel > 10) {
    throw new Error("urgencyLevel 必須介於 0 與 10 之間");
  }
  if (header.fromLocalId.length > FROM_LOCAL_ID_BYTES) {
    throw new Error(`fromLocalId 不得超過 ${FROM_LOCAL_ID_BYTES} 個字元`);
  }

  const locationDetailsBytes = encoder.encode(header.locationDetails);
  if (locationDetailsBytes.byteLength > MAX_LOCATION_DETAILS_BYTES) {
    throw new Error(`位置描述過長（>${MAX_LOCATION_DETAILS_BYTES} bytes）`);
  }

  const headerBytes = SOS_HEADER_FIXED_BYTES + locationDetailsBytes.byteLength;
  const out = new Uint8Array(headerBytes + body.byteLength);
  const view = new DataView(out.buffer);

  out[0] = header.version;
  out[1] = header.keyVersion;
  out[2] = header.type;
  for (let i = 0; i < MSG_ID_LENGTH; i++) {
    out[3 + i] = header.msgId.charCodeAt(i);
  }
  out[11] = header.ttl;
  out[12] = header.hops;
  out[13] = header.urgencyLevel;

  let flags = 0;
  if (header.isTrapped) flags |= FLAG_IS_TRAPPED;
  if (header.location) flags |= FLAG_HAS_LOCATION;
  if (header.battery !== undefined) flags |= FLAG_HAS_BATTERY;
  out[14] = flags;

  out[15] = header.battery ?? 0;
  view.setFloat32(16, header.location?.lat ?? 0, false);
  view.setFloat32(20, header.location?.lng ?? 0, false);

  // fromLocalId：固定 8 bytes，不足的部分留 \0（out 初始就是 0，不必額外填）
  for (let i = 0; i < Math.min(header.fromLocalId.length, FROM_LOCAL_ID_BYTES); i++) {
    out[24 + i] = header.fromLocalId.charCodeAt(i);
  }

  out[32] = locationDetailsBytes.byteLength;
  out.set(locationDetailsBytes, SOS_HEADER_FIXED_BYTES);

  out.set(body, headerBytes);
  return out;
}

/**
 * 解析收到的封包。
 *
 * **來源是不可信的裝置**——任何不合法的輸入都回傳 null，絕不拋錯。
 */
export function decodePacket(bytes: Uint8Array): Packet | null {
  if (bytes.byteLength < SOS_HEADER_FIXED_BYTES) return null;

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

  const urgencyLevel = bytes[13];
  if (urgencyLevel > 10) return null;

  const flags = bytes[14];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const battery = flags & FLAG_HAS_BATTERY ? bytes[15] : undefined;
  const location = flags & FLAG_HAS_LOCATION
    ? { lat: view.getFloat32(16, false), lng: view.getFloat32(20, false) }
    : undefined;

  // fromLocalId：固定 8 bytes，去掉補位的 \0；非可列印字元視為損毀封包
  let fromLocalId = "";
  for (let i = 0; i < FROM_LOCAL_ID_BYTES; i++) {
    const code = bytes[24 + i];
    if (code === 0) break;
    if (code < 0x20 || code > 0x7e) return null;
    fromLocalId += String.fromCharCode(code);
  }

  const locationDetailsLen = bytes[32];
  const headerBytes = SOS_HEADER_FIXED_BYTES + locationDetailsLen;
  if (bytes.byteLength < headerBytes) return null;

  let locationDetails: string;
  try {
    locationDetails = decoder.decode(bytes.subarray(SOS_HEADER_FIXED_BYTES, headerBytes));
  } catch {
    return null;
  }

  const header: PacketHeader = {
    version,
    keyVersion: bytes[1],
    type,
    msgId,
    ttl,
    hops: bytes[12],
    fromLocalId,
    urgencyLevel,
    isTrapped: (flags & FLAG_IS_TRAPPED) !== 0,
    battery,
    location,
    locationDetails,
  };

  return {
    header,
    body: new Uint8Array(bytes.subarray(headerBytes)),
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
  fromLocalId?: string;
  urgencyLevel?: number;
  isTrapped?: boolean;
  battery?: number;
  location?: { lat: number; lng: number };
  locationDetails?: string;
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
    fromLocalId: options.fromLocalId ?? "",
    urgencyLevel: options.urgencyLevel ?? 0,
    isTrapped: options.isTrapped ?? false,
    battery: options.battery,
    location: options.location,
    locationDetails: options.locationDetails ?? "",
  };
}
