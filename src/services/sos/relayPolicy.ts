/**
 * GuardiaAI SOS 中繼 - 轉發決策
 *
 * 「收到一個封包後該怎麼辦」的決策邏輯，刻意抽成**純函式**：
 * 它是整個中繼機制中最容易寫錯、也最需要被測試的部分，
 * 而它不該需要藍牙硬體才能驗證。
 *
 * relayEngine 負責跟藍牙互動（掃描、傳送），本檔只負責「決定」。
 */

import { PacketType, RelayAction, type Packet, type RelayContext } from "./sosTypes";

/**
 * 電量低於此值就不再幫別人轉發。
 *
 * 保住自己的求救能力優先——一支沒電的手機救不了任何人，包括自己。
 * 學術上稱為 energy-aware relay selection。
 */
export const RELAY_MIN_BATTERY = 20;

/** 電量高於此值才承擔全速中繼（掃描較頻繁） */
export const RELAY_FULL_BATTERY = 50;

/**
 * 決定收到這個封包後該做什麼。
 *
 * 判斷順序有意義，不可調換：
 *   1. 去重要最先——重複的封包連看都不必看
 *   2. ACK 要在上傳判斷之前——ACK 不需要上傳，它是從後端回來的
 *   3. 有網路就上傳，訊息就此離開藍牙網路，不必再耗別人的電轉發
 *   4. 沒網路才進入轉發判斷（TTL、電量）
 */
export function decideAction(packet: Packet, ctx: RelayContext): RelayAction {
  const { header } = packet;

  // 1. 去重。少了這道，訊息會在裝置間無限彈跳，燒乾所有人的電池。
  if (ctx.hasSeen(header.msgId)) {
    return RelayAction.DROP_DUPLICATE;
  }

  // 2. ACK：先看是不是回給自己的
  if (header.type === PacketType.ACK) {
    // 注意：這裡只判斷「型別是 ACK」。簽章驗證由呼叫端做——
    // 驗簽是非同步的，而本函式刻意保持同步且純粹。
    // 呼叫端必須在驗簽通過後才據此行動，否則惡意節點可偽造「求救已送達」，
    // 讓受困者放棄呼救。
    return RelayAction.DELIVER_ACK;
  }

  // 3. 我有網路 → 直接上傳。密文原封不動送出，我也解不開。
  if (ctx.isOnline) {
    return RelayAction.UPLOAD;
  }

  // 4. 沒網路 → 判斷是否值得轉發
  if (header.ttl <= 0) {
    return RelayAction.DROP_TTL_EXPIRED;
  }

  if (ctx.batteryLevel < RELAY_MIN_BATTERY) {
    return RelayAction.DROP_LOW_BATTERY;
  }

  return RelayAction.RELAY;
}

/**
 * 收到 ACK 且驗簽通過後，判斷這則 ACK 是不是在回應「我自己發出的求救」。
 *
 * 是 → UI 顯示「你的求救已送出」
 * 否 → 我只是中繼者，把 ACK 繼續往回傳，並把對應的待轉發封包移除
 *      （後端已經收到了，不必再有人幫忙轉）
 */
export function isAckForMe(refId: string, ctx: RelayContext): boolean {
  return ctx.myPendingSosIds.has(refId);
}

/**
 * 依電量決定掃描間隔。
 *
 * 中繼者必須常駐掃描才接得到訊息，但掃描很耗電——電量越低，掃得越省。
 */
export function scanIntervalForBattery(batteryLevel: number): number {
  if (batteryLevel < RELAY_MIN_BATTERY) return 0; // 不主動中繼
  if (batteryLevel < RELAY_FULL_BATTERY) return 30_000; // 省電模式
  return 15_000; // 全速
}
