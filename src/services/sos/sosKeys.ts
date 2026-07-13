/**
 * GuardiaAI SOS 中繼 - 後端金鑰設定
 *
 * 信任模型的根：App 內建後端的**公鑰**，後端持有私鑰。
 *
 *   - 求救內容以後端公鑰加密 → 中繼者（陌生人）解不開，只有後端能讀
 *   - ACK 由後端私鑰簽章 → 中繼者偽造不出「已送達」回執
 *
 * 公鑰必須**內建在 App 裡**，不能在災難當下才去下載——那時候正是沒有網路的時候。
 *
 * ---------------------------------------------------------------------------
 * 尚未設定：這些金鑰必須由後端產生
 * ---------------------------------------------------------------------------
 *
 * 後端需要產生兩組 P-256 金鑰對，把**公鑰**填進下面，私鑰留在伺服器上：
 *
 *   1. ECDH 金鑰對 —— 用於解密求救內容
 *   2. ECDSA 金鑰對 —— 用於簽章 ACK 回執
 *
 * 產生方式（Node.js）：
 *
 *   const { webcrypto } = require("crypto");
 *   const pair = await webcrypto.subtle.generateKey(
 *     { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
 *   const raw = await webcrypto.subtle.exportKey("raw", pair.publicKey);
 *   console.log(Buffer.from(raw).toString("base64"));   // ← 填進 encryptionPublicKey
 *
 * ECDSA 同理（usages 改成 ["sign", "verify"]，匯出 publicKey）。
 *
 * 私鑰請匯出成 pkcs8 並安全保存在後端，**絕不可進版控**。
 */

export interface BackendKeys {
  /** 金鑰版本。後端輪替金鑰後，舊版 App 發出的封包仍能被正確解讀 */
  version: number;
  /** ECDH P-256 公鑰（raw，65 bytes，base64）。用於加密求救內容 */
  encryptionPublicKey: string;
  /** ECDSA P-256 公鑰（raw，65 bytes，base64）。用於驗證 ACK 簽章 */
  ackVerifyPublicKey: string;
}

/**
 * 目前設定的後端金鑰。
 *
 * **尚未設定。** 後端產生金鑰後填入此處（或改由建置時的環境變數注入）。
 * 未設定時，發送求救會明確失敗——這是刻意的：與其送出一個沒有加密、
 * 讓沿途所有陌生人都讀得到你的位置和病史的封包，不如直接拒絕送出。
 */
export const BACKEND_KEYS: BackendKeys | null = null;

/** 取得後端金鑰；未設定時拋出可讀的錯誤 */
export function requireBackendKeys(): BackendKeys {
  if (!BACKEND_KEYS) {
    throw new Error(
      "後端加密金鑰尚未設定。求救內容無法加密，因此拒絕送出——" +
        "未加密的封包會讓沿途所有陌生人讀到你的位置與醫療資訊。" +
        "請見 src/services/sos/sosKeys.ts。",
    );
  }
  return BACKEND_KEYS;
}

/** 金鑰是否已設定（UI 可據此顯示「此功能尚未啟用」而非讓使用者按了才失敗） */
export function hasBackendKeys(): boolean {
  return BACKEND_KEYS !== null;
}
