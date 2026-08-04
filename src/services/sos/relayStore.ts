/**
 * GuardiaAI SOS 中繼 - store-and-forward 儲存
 *
 * 兩個職責：
 *   1. **去重**：記住看過哪些 msgId。沒有這個，訊息會在裝置之間無限彈跳，
 *      把所有人的電池燒乾。
 *   2. **待轉發佇列**：暫存還沒送出去的封包，等下次掃到別人時一併傳出。
 *
 * 去重表用 LRU 上限而非時間逾時：災害現場可能持續數小時，訊息不該因為
 * 「太久以前看過」就被當成新訊息重新擴散。
 */

import type { Packet } from "./sosTypes";

/** 記憶的 msgId 上限 */
export const SEEN_IDS_LIMIT = 200;

/** 待轉發佇列的上限。避免惡意端灌爆記憶體 */
export const PENDING_LIMIT = 50;

export class RelayStore {
  /** 看過的 msgId。用 Map 是為了靠插入順序實作 LRU 淘汰 */
  private seen = new Map<string, number>();

  /** 待轉發的封包，以 msgId 為 key（同一則訊息不會排兩次） */
  private pending = new Map<string, Packet>();

  constructor(
    private readonly seenLimit: number = SEEN_IDS_LIMIT,
    private readonly pendingLimit: number = PENDING_LIMIT,
  ) {}

  // -------------------------------------------------------------------------
  // 去重
  // -------------------------------------------------------------------------

  hasSeen(msgId: string): boolean {
    return this.seen.has(msgId);
  }

  /** 記下一個 msgId。超過上限時淘汰最舊的。 */
  markSeen(msgId: string, now: number = Date.now()): void {
    // 重新插入以更新順序（Map 的插入順序即 LRU 順序）
    this.seen.delete(msgId);
    this.seen.set(msgId, now);

    while (this.seen.size > this.seenLimit) {
      const oldest = this.seen.keys().next();
      if (oldest.done) break;
      this.seen.delete(oldest.value);
    }
  }

  get seenCount(): number {
    return this.seen.size;
  }

  // -------------------------------------------------------------------------
  // 待轉發佇列
  // -------------------------------------------------------------------------

  /** 排入待轉發。同一則訊息重複排入只會保留一份。 */
  enqueue(packet: Packet): void {
    const { msgId } = packet.header;

    this.pending.delete(msgId);
    this.pending.set(msgId, packet);

    while (this.pending.size > this.pendingLimit) {
      const oldest = this.pending.keys().next();
      if (oldest.done) break;
      this.pending.delete(oldest.value);
    }
  }

  /** 取出所有待轉發的封包（不移除——要等真的送出去才移除） */
  getPending(): Packet[] {
    return Array.from(this.pending.values());
  }

  /**
   * 移除一則待轉發的封包。
   *
   * 兩種時機：成功送出去了，或收到該訊息的 ACK（後端已收到，不必再轉）。
   */
  remove(msgId: string): void {
    this.pending.delete(msgId);
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  clear(): void {
    this.seen.clear();
    this.pending.clear();
  }
}
