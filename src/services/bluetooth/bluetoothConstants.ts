/**
 * GuardiaAI 藍牙模組 - 共用常數
 *
 * 此檔內的 UUID **必須與 iOS 端 BlePeripheralManager.swift 完全一致**，
 * 否則 Central 端會掃不到、寫不進 Peripheral 端。
 */

/** GuardiaAI 服務 UUID — 同 App 互相識別的依據 */
export const GUARDIA_SERVICE_UUID = "7E5F9B40-9C8E-4F1A-A0D3-2C1B7E0A5F40";

/** 收件特徵值 UUID — Central 將訊息寫入此特徵 */
export const GUARDIA_INBOX_CHAR_UUID = "7E5F9B40-9C8E-4F1A-A0D3-2C1B7E0A5F41";

/** 預設掃描秒數（一輪掃描多久後停止）。iOS 過長會耗電、過短可能掃不到 */
export const DEFAULT_SCAN_DURATION_MS = 8000;

/** 訊息 payload 最大長度（bytes）。BLE GATT 預設 MTU 約 23 bytes，
 *  扣掉 header 後實際可寫約 20 bytes。要傳長訊息需要先 negotiate MTU。
 *  此處設保守值，超過會被截斷或拆封包（v1 先不拆）。 */
export const MAX_MESSAGE_BYTES = 180;
