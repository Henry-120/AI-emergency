/**
 * GuardiaAI 藍牙模組 - 訊息分片與重組
 *
 * 為什麼需要：
 *
 * BLE 單次寫入的長度受 ATT MTU 限制（見 MAX_FRAME_BYTES）。舊版的做法是「超過就
 * 拒絕傳送」，使用者只能打約 46 個中文字。導入 SOS 中繼後，加密封包本身就會超過
 * 單包上限，因此分片從「加分項」變成「必需品」。
 *
 * 封包格式（固定 11 bytes 標頭 + payload）：
 *
 *   byte  0      版本（目前為 1）
 *   bytes 1–8    frameId：本則訊息的識別碼（8 個 ASCII 字元）
 *   byte  9      chunkIndex：這是第幾片（從 0 開始）
 *   byte  10     chunkTotal：總共幾片
 *   bytes 11+    payload：該片的原始 bytes
 *
 * 刻意用**固定長度的二進位標頭**而非分隔符（如 `|`）：訊息文字本身可能包含任何
 * 字元，用分隔符解析會在使用者輸入 `|` 時出錯。
 */

import {
  CHUNK_REASSEMBLY_TIMEOUT_MS,
  MAX_FRAME_BYTES,
  MAX_MESSAGE_BYTES,
} from "./bluetoothConstants";

/** 封包格式版本。未來若改格式，接收端可據此拒絕不認得的版本。 */
export const FRAME_VERSION = 1;

/** 標頭長度：1 (版本) + 8 (frameId) + 1 (index) + 1 (total) */
export const FRAME_HEADER_BYTES = 11;

/** frameId 的字元數 */
const FRAME_ID_LENGTH = 8;

/** chunkIndex / chunkTotal 各只有 1 byte，故最多 255 片 */
const MAX_CHUNKS = 255;

const FRAME_ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export interface ParsedFrame {
  version: number;
  frameId: string;
  index: number;
  total: number;
  payload: Uint8Array;
}

/** 產生一則訊息的 frameId（同一則訊息的所有分片共用） */
export function generateFrameId(): string {
  const out: string[] = [];
  const cryptoObj = typeof crypto !== "undefined" ? crypto : undefined;

  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(FRAME_ID_LENGTH);
    cryptoObj.getRandomValues(bytes);
    for (let i = 0; i < FRAME_ID_LENGTH; i++) {
      out.push(FRAME_ID_ALPHABET[bytes[i] % FRAME_ID_ALPHABET.length]);
    }
  } else {
    for (let i = 0; i < FRAME_ID_LENGTH; i++) {
      out.push(
        FRAME_ID_ALPHABET[Math.floor(Math.random() * FRAME_ID_ALPHABET.length)],
      );
    }
  }

  return out.join("");
}

/**
 * 把一則訊息的 bytes 拆成多個可直接寫入 BLE 的分片。
 *
 * @throws 訊息超過 MAX_MESSAGE_BYTES，或片數超過 255 時
 */
export function splitIntoFrames(
  frameId: string,
  payload: Uint8Array,
  maxFrameBytes: number = MAX_FRAME_BYTES,
): Uint8Array[] {
  if (frameId.length !== FRAME_ID_LENGTH) {
    throw new Error(`frameId 必須是 ${FRAME_ID_LENGTH} 個字元`);
  }
  if (payload.byteLength > MAX_MESSAGE_BYTES) {
    throw new Error(`訊息過長（${payload.byteLength} > ${MAX_MESSAGE_BYTES} bytes）`);
  }

  const maxPayloadPerFrame = maxFrameBytes - FRAME_HEADER_BYTES;
  if (maxPayloadPerFrame <= 0) {
    throw new Error("maxFrameBytes 必須大於標頭長度");
  }

  // 空訊息也要送出一片，否則接收端永遠等不到
  const total = Math.max(1, Math.ceil(payload.byteLength / maxPayloadPerFrame));
  if (total > MAX_CHUNKS) {
    throw new Error(`分片數超過上限（${total} > ${MAX_CHUNKS}）`);
  }

  const frames: Uint8Array[] = [];

  for (let i = 0; i < total; i++) {
    const start = i * maxPayloadPerFrame;
    const chunk = payload.subarray(start, start + maxPayloadPerFrame);

    const frame = new Uint8Array(FRAME_HEADER_BYTES + chunk.byteLength);
    frame[0] = FRAME_VERSION;
    for (let c = 0; c < FRAME_ID_LENGTH; c++) {
      frame[1 + c] = frameId.charCodeAt(c);
    }
    frame[9] = i;
    frame[10] = total;
    frame.set(chunk, FRAME_HEADER_BYTES);

    frames.push(frame);
  }

  return frames;
}

/**
 * 解析一個收到的分片。
 *
 * @returns 格式不合法時回傳 null（呼叫端應直接丟棄，不可拋錯——來源是不可信的裝置）
 */
export function parseFrame(bytes: Uint8Array): ParsedFrame | null {
  if (bytes.byteLength < FRAME_HEADER_BYTES) return null;

  const version = bytes[0];
  if (version !== FRAME_VERSION) return null;

  let frameId = "";
  for (let c = 0; c < FRAME_ID_LENGTH; c++) {
    const code = bytes[1 + c];
    // frameId 必須是可列印的 ASCII，否則視為損毀封包
    if (code < 0x20 || code > 0x7e) return null;
    frameId += String.fromCharCode(code);
  }

  const index = bytes[9];
  const total = bytes[10];

  if (total === 0) return null;
  if (index >= total) return null;

  return {
    version,
    frameId,
    index,
    total,
    payload: bytes.subarray(FRAME_HEADER_BYTES),
  };
}

interface PendingMessage {
  total: number;
  chunks: Map<number, Uint8Array>;
  receivedBytes: number;
  firstSeenAt: number;
}

/**
 * 分片重組器。
 *
 * 依 (來源, frameId) 分組收集分片，收齊後回傳完整的 payload。
 *
 * 逾時清理是必要的：對方可能傳到一半就走出範圍，殘片若不清會永久佔用記憶體
 * ——這在惡意端刻意只送第 1 片、不送其餘時就是一個資源耗盡的攻擊面。
 */
export class FrameReassembler {
  private pending = new Map<string, PendingMessage>();

  /**
   * 最近已完成的訊息（key → 完成時間）。
   *
   * 分片可能重複抵達（對方重送、藍牙堆疊重放）。少了這道去重：
   *   - 單片訊息重複抵達 → 同一則訊息會被**送出兩次**
   *   - 多片訊息的最後一片重複抵達 → 會開一組新的殘片，留在記憶體裡等逾時
   */
  private completed = new Map<string, number>();

  constructor(
    private readonly timeoutMs: number = CHUNK_REASSEMBLY_TIMEOUT_MS,
    private readonly maxMessageBytes: number = MAX_MESSAGE_BYTES,
  ) {}

  /**
   * 加入一個分片。
   *
   * @param sourceId 來源識別（不同來源的同名 frameId 不可混在一起）
   * @returns 收齊時回傳完整 payload；尚未收齊或為重複封包則回傳 null
   */
  add(sourceId: string, frame: ParsedFrame, now: number = Date.now()): Uint8Array | null {
    this.prune(now);

    const key = `${sourceId}::${frame.frameId}`;

    // 這則訊息剛剛才組好 → 這是重複的分片，直接忽略
    if (this.completed.has(key)) return null;

    // 單片訊息不必進入 pending，直接回傳
    if (frame.total === 1) {
      if (frame.payload.byteLength > this.maxMessageBytes) return null;
      this.completed.set(key, now);
      return new Uint8Array(frame.payload);
    }

    let entry = this.pending.get(key);

    if (!entry) {
      entry = { total: frame.total, chunks: new Map(), receivedBytes: 0, firstSeenAt: now };
      this.pending.set(key, entry);
    }

    // 同一 frameId 的 total 前後不一致 → 封包損毀或惡意，整組丟棄
    if (entry.total !== frame.total) {
      this.pending.delete(key);
      return null;
    }

    // 重複的分片：忽略，不重複累加 bytes
    if (entry.chunks.has(frame.index)) return null;

    // 超過訊息長度上限 → 丟棄整組，避免記憶體被灌爆
    if (entry.receivedBytes + frame.payload.byteLength > this.maxMessageBytes) {
      this.pending.delete(key);
      return null;
    }

    entry.chunks.set(frame.index, new Uint8Array(frame.payload));
    entry.receivedBytes += frame.payload.byteLength;

    if (entry.chunks.size !== entry.total) return null;

    // 收齊了：依序拼回完整 payload
    const complete = new Uint8Array(entry.receivedBytes);
    let offset = 0;
    for (let i = 0; i < entry.total; i++) {
      const chunk = entry.chunks.get(i);
      if (!chunk) {
        // 理論上不會發生（size 已等於 total），防禦性處理
        this.pending.delete(key);
        return null;
      }
      complete.set(chunk, offset);
      offset += chunk.byteLength;
    }

    this.pending.delete(key);
    this.completed.set(key, now);
    return complete;
  }

  /** 清掉逾時未收齊的殘片，以及過期的去重紀錄 */
  prune(now: number = Date.now()): void {
    for (const [key, entry] of this.pending) {
      if (now - entry.firstSeenAt > this.timeoutMs) {
        this.pending.delete(key);
      }
    }
    for (const [key, completedAt] of this.completed) {
      if (now - completedAt > this.timeoutMs) {
        this.completed.delete(key);
      }
    }
  }

  /** 目前有幾組未收齊的訊息（測試與診斷用） */
  get pendingCount(): number {
    return this.pending.size;
  }
}
