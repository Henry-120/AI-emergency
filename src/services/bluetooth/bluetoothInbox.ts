/**
 * GuardiaAI 藍牙模組 - 常駐收件匣
 *
 * 為什麼需要這個檔案：
 *
 * 舊版把「訂閱原生收訊事件」寫在 NearbyPeoplePage 的 useEffect 裡，unmount 時就
 * unsubscribe。結果是**使用者一離開「附近的人」頁面，別人傳來的訊息就完全收不到，
 * 也不會留存**。對一個災害求生 App 而言，這是致命的。
 *
 * 這個模組是 App 層級的單例：啟動時訂閱一次原生事件，之後不論使用者在哪個畫面，
 * 訊息都會被收下、存起來、並累計未讀數。UI 只訂閱它的變化；頁面卸載不影響收訊。
 *
 * 收發雙向的訊息都存在這裡——只存收到的話，離開頁面後自己傳出的訊息會消失，
 * 對話只剩一半。
 */

import {
  INBOX_MAX_MESSAGES,
  INBOX_STORAGE_KEY,
  STATUS_POLL_INTERVAL_MS,
} from "./bluetoothConstants";
import { isValidMessage } from "./bluetoothValidation";
import { getStatus, subscribeMessages } from "./bluetoothService";
import type { BluetoothStatus, ChatRecord } from "./bluetoothTypes";

type Listener = () => void;

let records: ChatRecord[] = [];
let unreadCount = 0;
let status: BluetoothStatus | null = null;

let nativeUnsub: (() => void) | null = null;
let statusTimer: ReturnType<typeof setInterval> | null = null;
let initializing: Promise<void> | null = null;

const listeners = new Set<Listener>();

function emit(): void {
  listeners.forEach((l) => l());
}

// ---------------------------------------------------------------------------
// 持久化
// ---------------------------------------------------------------------------

function isValidRecord(v: unknown): v is ChatRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;

  if (r.direction !== "in" && r.direction !== "out") return false;
  if (typeof r.peerId !== "string" || r.peerId.length === 0) return false;
  return isValidMessage(r.message);
}

function load(): ChatRecord[] {
  try {
    const raw = localStorage.getItem(INBOX_STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // 存進去的資料一樣要驗——localStorage 可能被舊版格式或手動改動污染
    return parsed.filter(isValidRecord);
  } catch {
    return [];
  }
}

function persist(): void {
  try {
    localStorage.setItem(INBOX_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // 空間不足或隱私模式 → 記憶體中仍可運作，只是重開後會消失
  }
}

function append(record: ChatRecord): void {
  records = [...records, record].slice(-INBOX_MAX_MESSAGES);
  persist();
  emit();
}

// ---------------------------------------------------------------------------
// 生命週期
// ---------------------------------------------------------------------------

/**
 * 啟動收件匣。應在 App 啟動時呼叫一次（App.tsx），**不要在 cleanup 中取消**。
 *
 * 重複呼叫是安全的（no-op）。
 */
export async function initInbox(): Promise<void> {
  if (nativeUnsub) return;
  if (initializing) return initializing;

  initializing = (async () => {
    records = load();

    try {
      nativeUnsub = await subscribeMessages((msg) => {
        unreadCount += 1;
        append({ direction: "in", peerId: msg.from, message: msg });
      });
    } catch (err) {
      console.error("[BLE] 收件匣訂閱失敗", err);
    }

    // 藍牙狀態要持續輪詢：使用者可能隨時在系統設定關掉藍牙。
    // 只在進頁面時查一次的話，UI 會一直顯示過期的「廣播中」。
    await refreshStatus();
    if (!statusTimer) {
      statusTimer = setInterval(() => void refreshStatus(), STATUS_POLL_INTERVAL_MS);
    }
  })();

  try {
    await initializing;
  } finally {
    initializing = null;
  }
}

async function refreshStatus(): Promise<void> {
  try {
    const next = await getStatus();
    const changed =
      !status ||
      status.isNative !== next.isNative ||
      status.isEnabled !== next.isEnabled ||
      status.isAdvertising !== next.isAdvertising ||
      status.isScanning !== next.isScanning;

    status = next;
    if (changed) emit();
  } catch {
    // 查不到狀態就沿用上一次的值
  }
}

/** 立刻重查一次狀態（切換廣播後呼叫，不必等下一輪輪詢） */
export function refreshStatusNow(): void {
  void refreshStatus();
}

// ---------------------------------------------------------------------------
// 對 UI 的介面
// ---------------------------------------------------------------------------

/** 訂閱收件匣變化。回傳的 unsubscribe 只解除 UI 訂閱，原生收訊仍持續運作。 */
export function subscribeInbox(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 記下一則自己傳出的訊息 */
export function recordOutgoing(peerId: string, message: ChatRecord["message"]): void {
  append({ direction: "out", peerId, message });
}

export function getRecords(): ChatRecord[] {
  return records;
}

/** 取得與某人的完整對話（含自己傳出的），依時間排序 */
export function getConversation(peerId: string): ChatRecord[] {
  return records
    .filter((r) => r.peerId === peerId)
    .sort((a, b) => a.message.timestamp - b.message.timestamp);
}

/** 有傳過訊息往來的對象清單 */
export function getPeerIds(): string[] {
  return Array.from(new Set(records.map((r) => r.peerId)));
}

export function getUnreadCount(): number {
  return unreadCount;
}

export function markAllRead(): void {
  if (unreadCount === 0) return;
  unreadCount = 0;
  emit();
}

export function getCachedStatus(): BluetoothStatus | null {
  return status;
}

/** 清空收件匣 */
export function clearInbox(): void {
  records = [];
  unreadCount = 0;
  persist();
  emit();
}
