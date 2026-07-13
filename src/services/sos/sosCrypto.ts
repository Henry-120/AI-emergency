/**
 * GuardiaAI SOS 中繼 - 加密與簽章
 *
 * 這個檔案實現整個中繼的信任模型：**中繼者只搬箱子，不開箱。**
 *
 * 加密（求救內容 → 只有後端讀得到）
 *   標準混合加密（hybrid encryption）：
 *     1. 產生一組臨時 ECDH 金鑰對
 *     2. 臨時私鑰 + 後端公鑰 → ECDH → 導出 AES-256 對稱金鑰
 *     3. 以 AES-256-GCM 加密內容（GCM 同時提供完整性驗證）
 *     4. 送出：臨時公鑰 ‖ IV ‖ 密文+認證標籤
 *   後端用自己的私鑰重做 ECDH 得到同一把對稱金鑰，即可解密。
 *   中繼者沒有後端私鑰 → 解不開。
 *
 * 簽章（ACK → 中繼者偽造不出來）
 *   後端以 ECDSA P-256 私鑰簽章，App 用內建公鑰驗簽。
 *   這道防護是必要的：能偽造 ACK 的惡意節點可以讓受困者誤以為求救已送達
 *   而停止呼救——那比洩漏內容更致命。
 *
 * 全部使用 Web Crypto API（crypto.subtle），iOS WebView 原生支援，無需外部函式庫。
 *
 * ---------------------------------------------------------------------------
 * 封包內容的長度成本（誠實面對）
 * ---------------------------------------------------------------------------
 *   臨時公鑰 65 bytes（Web Crypto 的 raw 匯出是未壓縮點；壓縮點 33 bytes 需要
 *                      自行實作橢圓曲線點解壓縮，SubtleCrypto 不支援）
 *   IV        12 bytes
 *   GCM 標籤  16 bytes（附在密文尾端）
 *   ─────────────────
 *   合計約 93 bytes 的額外開銷，加上 14 bytes 明文標頭。
 *
 * 這正是分片（bluetoothChunking）非做不可的原因：加密後的求救封包塞不進
 * 單一 BLE 封包。
 */

import { requireBackendKeys } from "./sosKeys";
import type { AckPayload, SosPayload } from "./sosTypes";

/** 臨時 ECDH 公鑰（raw，未壓縮點）的長度 */
export const EPHEMERAL_KEY_BYTES = 65;

/** AES-GCM 的 IV 長度 */
export const IV_BYTES = 12;

/** ECDSA P-256 的 raw 簽章長度（r ‖ s，各 32 bytes） */
export const SIGNATURE_BYTES = 64;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---------------------------------------------------------------------------
// base64 工具
// ---------------------------------------------------------------------------

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** subtle.* 需要 ArrayBuffer；Uint8Array 可能是別人 buffer 的一段 view，必須切出來 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

// ---------------------------------------------------------------------------
// 加密：求救內容 → 只有後端解得開
// ---------------------------------------------------------------------------

/** 由臨時私鑰與對方公鑰導出 AES-256-GCM 金鑰 */
async function deriveAesKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * 把求救內容加密給後端。
 *
 * @param recipientPublicKeyB64 後端的 ECDH 公鑰（base64 raw）。省略時取內建金鑰。
 * @returns 可直接放進封包 body 的 bytes：臨時公鑰 ‖ IV ‖ 密文
 */
export async function encryptForBackend(
  payload: SosPayload,
  recipientPublicKeyB64?: string,
): Promise<Uint8Array> {
  const publicKeyB64 = recipientPublicKeyB64 ?? requireBackendKeys().encryptionPublicKey;

  const backendPublicKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(base64ToBytes(publicKeyB64)),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  // 每則訊息都用一組全新的臨時金鑰：即使某則訊息的金鑰外洩，也不影響其他訊息
  const ephemeral = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"],
  );

  const aesKey = await deriveAesKey(ephemeral.privateKey, backendPublicKey);

  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = encoder.encode(JSON.stringify(payload));

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      aesKey,
      toArrayBuffer(plaintext),
    ),
  );

  const ephemeralPublicRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", ephemeral.publicKey),
  );

  const out = new Uint8Array(
    EPHEMERAL_KEY_BYTES + IV_BYTES + ciphertext.byteLength,
  );
  out.set(ephemeralPublicRaw, 0);
  out.set(iv, EPHEMERAL_KEY_BYTES);
  out.set(ciphertext, EPHEMERAL_KEY_BYTES + IV_BYTES);

  return out;
}

/**
 * 解密求救內容。
 *
 * **這是後端才會執行的操作**——App 端沒有私鑰，也不該有。
 * 放在這裡是為了讓協定能被端到端測試，並作為後端實作的參考。
 *
 * @returns 解不開（金鑰不對、內容被竄改、格式損毀）一律回傳 null，不拋錯
 */
export async function decryptAsBackend(
  body: Uint8Array,
  backendPrivateKey: CryptoKey,
): Promise<SosPayload | null> {
  if (body.byteLength < EPHEMERAL_KEY_BYTES + IV_BYTES) return null;

  try {
    const ephemeralPublicRaw = body.subarray(0, EPHEMERAL_KEY_BYTES);
    const iv = body.subarray(EPHEMERAL_KEY_BYTES, EPHEMERAL_KEY_BYTES + IV_BYTES);
    const ciphertext = body.subarray(EPHEMERAL_KEY_BYTES + IV_BYTES);

    const ephemeralPublicKey = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(ephemeralPublicRaw),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );

    const aesKey = await deriveAesKey(backendPrivateKey, ephemeralPublicKey);

    // AES-GCM 的認證標籤在此驗證：內容若被竄改，decrypt 會直接拋錯
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      aesKey,
      toArrayBuffer(ciphertext),
    );

    return JSON.parse(decoder.decode(plaintext)) as SosPayload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 簽章：ACK 防偽
// ---------------------------------------------------------------------------

/**
 * 後端簽章一則 ACK。
 *
 * **這是後端才會執行的操作**（需要私鑰）。放在這裡供測試與後端參考。
 *
 * @returns 可直接放進封包 body 的 bytes：簽章 ‖ 明文回執
 */
export async function signAckAsBackend(
  payload: AckPayload,
  backendSigningKey: CryptoKey,
): Promise<Uint8Array> {
  const body = encoder.encode(JSON.stringify(payload));

  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      backendSigningKey,
      toArrayBuffer(body),
    ),
  );

  const out = new Uint8Array(SIGNATURE_BYTES + body.byteLength);
  out.set(signature, 0);
  out.set(body, SIGNATURE_BYTES);
  return out;
}

/**
 * 驗證一則 ACK 確實由後端簽發。
 *
 * 這是受困者端的把關：**驗簽失敗一律丟棄**。
 * 若讓未簽章的 ACK 通過，惡意中繼者就能讓受困者以為求救已送出而放棄呼救。
 *
 * @param verifyPublicKeyB64 後端的 ECDSA 公鑰（base64 raw）。省略時取內建金鑰。
 * @returns 驗證通過回傳回執內容；任何一步失敗都回傳 null
 */
export async function verifyAck(
  body: Uint8Array,
  verifyPublicKeyB64?: string,
): Promise<AckPayload | null> {
  if (body.byteLength <= SIGNATURE_BYTES) return null;

  try {
    const publicKeyB64 = verifyPublicKeyB64 ?? requireBackendKeys().ackVerifyPublicKey;

    const publicKey = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(base64ToBytes(publicKeyB64)),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );

    const signature = body.subarray(0, SIGNATURE_BYTES);
    const signed = body.subarray(SIGNATURE_BYTES);

    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      toArrayBuffer(signature),
      toArrayBuffer(signed),
    );
    if (!ok) return null;

    const parsed = JSON.parse(decoder.decode(signed)) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;

    const ack = parsed as Record<string, unknown>;
    if (typeof ack.refId !== "string" || ack.refId.length === 0) return null;
    if (typeof ack.uploadedAt !== "number" || !Number.isFinite(ack.uploadedAt)) return null;

    return { refId: ack.refId, uploadedAt: ack.uploadedAt };
  } catch {
    return null;
  }
}
