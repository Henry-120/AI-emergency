/**
 * GuardiaAI SOS 中繼 - 引擎
 *
 * 把 sosProtocol / sosCrypto / relayPolicy / relayStore（皆為純函式或純資料結構）
 * 接上實際的動作：藍牙收發、背景掃描、呼叫後端上傳、UI 狀態通知。
 *
 * 角色（呼應使用者原本的構想）：
 *   受困者      ：呼叫 submitSos() 送出求救，本機沒網路時封包會先存起來，
 *                 等掃到任何一個附近裝置就遞出去。
 *   中繼者      ：手機背景持續掃描；收到別人的 SOS/ALERT 封包時，
 *                 有網路就直接幫忙上傳給後端，沒網路就存著等下一次遇到人。
 *   後端        ：解密、記錄、簽一份 ACK 回傳。
 *   ACK 回傳路徑：中繼者把 ACK 封包當成普通中繼流量繼續往外傳播，
 *                 沿路每個裝置都檢查「這是不是回給我自己的」，直到傳回受困者本人。
 *
 * 簡化（MVP，非最終設計）：
 *   - 待轉發佇列以「成功送給任一個附近裝置一次」視為完成並從佇列移除，
 *     不追蹤該裝置是否真的又繼續往外傳——真正的送達保證要靠對方的 ACK。
 *     自己發出的求救例外：在收到 ACK 前會持續嘗試遞給每個新掃到的裝置。
 *   - 沒有 App 層級的休眠/背景排程整合，背景掃描只在 App 開著時運作
 *     （iOS 背景掃描本身也有系統限制，見 docs/ios-bluetooth-setup.md 的已知限制）。
 */

import {
  decrementForRelay,
  encodePacket,
  createHeader,
  decodePacket,
  DEFAULT_TTL,
} from "./sosProtocol";
import { encryptForBackend, verifyAck } from "./sosCrypto";
import { hasBackendKeys, BACKEND_KEYS } from "./sosKeys";
import { decideAction, isAckForMe, scanIntervalForBattery } from "./relayPolicy";
import { RelayStore } from "./relayStore";
import { PacketType, RelayAction, Severity, type Packet, type RelayContext } from "./sosTypes";
import { buildSosPayload, readBatteryLevel, type BuildSosPayloadOptions } from "./sosPayloadBuilder";
import {
  scanNearby,
  sendSos,
  subscribeSosPackets,
  getLocalId,
} from "../bluetooth/bluetoothService";
import { BACKEND } from "../backend";

export type SosDeliveryStatus =
  | "sending"
  | "queued_offline"
  | "uploaded"
  | "delivered"
  | "failed";

interface SosRecord {
  status: SosDeliveryStatus;
  createdAt: number;
  error?: string;
}

const records = new Map<string, SosRecord>();
const listeners = new Set<() => void>();
const relayStore = new RelayStore();

let initialized = false;
let backgroundScanTimer: ReturnType<typeof setTimeout> | null = null;
let currentBatteryLevel = 100;

function emit(): void {
  listeners.forEach((l) => l());
}

function setStatus(msgId: string, status: SosDeliveryStatus, error?: string): void {
  records.set(msgId, { ...(records.get(msgId) ?? { createdAt: Date.now() }), status, error });
  emit();
}

/** 訂閱 SOS 狀態變化（給 UI 使用） */
export function subscribeSosStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 目前所有求救的狀態快照（msgId → 狀態），最新的在前 */
export function getSosRecords(): Array<{ msgId: string } & SosRecord> {
  return Array.from(records.entries())
    .map(([msgId, record]) => ({ msgId, ...record }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** 後端金鑰是否已設定——UI 應據此顯示「此功能尚未啟用」，而非讓使用者按了才失敗 */
export function isSosEnabled(): boolean {
  return hasBackendKeys();
}

// ---------------------------------------------------------------------------
// 送出求救
// ---------------------------------------------------------------------------

export interface SubmitSosOptions extends BuildSosPayloadOptions {
  severity: number;
}

/**
 * 送出一則求救。
 *
 * 流程：組 payload → 加密 → 編碼成封包 → 記自己的 msgId（等 ACK 用）→
 * 本機有網路就直接上傳，沒有就存進待轉發佇列，並立刻試著掃一輪附近裝置。
 *
 * @returns msgId，供 UI 對照 getSosRecords() 追蹤這則求救的狀態
 */
export async function submitSos(options: SubmitSosOptions): Promise<string> {
  if (!hasBackendKeys()) {
    throw new Error("後端加密金鑰尚未設定，無法送出求救");
  }

  const payload = await buildSosPayload(options);
  const body = await encryptForBackend(payload);
  const header = createHeader({
    type: PacketType.SOS,
    keyVersion: BACKEND_KEYS!.version,
    severity: options.severity ?? Severity.NONE,
    ttl: DEFAULT_TTL,
  });
  const packet: Packet = { header, body };
  const msgId = header.msgId;

  relayStore.markSeen(msgId);
  myPendingSosIds.add(msgId);
  setStatus(msgId, "sending");

  if (navigator.onLine) {
    await uploadPacket(packet);
  } else {
    relayStore.enqueue(packet);
    setStatus(msgId, "queued_offline");
    void tryFlushToAnyNearbyPeer();
  }

  return msgId;
}

// ---------------------------------------------------------------------------
// 中繼決策的執行（收到封包後該做什麼，實際做出來）
// ---------------------------------------------------------------------------

/** 自己發出過、還在等 ACK 的求救 msgId */
const myPendingSosIds = new Set<string>();

async function uploadPacket(packet: Packet): Promise<void> {
  const msgId = packet.header.msgId;
  try {
    const res = await fetch(`${BACKEND}/api/sos/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packet: bytesToBase64(encodePacket(packet)) }),
    });
    if (!res.ok) throw new Error(`後端回應 HTTP ${res.status}`);

    const data = (await res.json()) as { ack_packet: string };
    const ackPacket = decodePacket(base64ToBytes(data.ack_packet));
    if (ackPacket) {
      // 把 ACK 當成一般中繼流量繼續往外傳播，讓它有機會傳回原發送者
      relayStore.enqueue(ackPacket);
      void tryFlushToAnyNearbyPeer();
    }

    if (myPendingSosIds.has(msgId)) {
      setStatus(msgId, "uploaded"); // 自己上傳成功；真正的「已送達」要等 ACK 傳回來確認
    }
  } catch (err) {
    if (myPendingSosIds.has(msgId)) {
      setStatus(msgId, "failed", err instanceof Error ? err.message : String(err));
    }
    // 上傳失敗（後端連不到等）→ 退回存進待轉發佇列，之後再找機會（自己上網或遇到別人）
    relayStore.enqueue(packet);
  }
}

/**
 * 收到一個 SOS 中繼封包（來自附近某裝置的 GATT write）。
 *
 * 對應 relayPolicy.decideAction 的四種結果：
 *   DROP_*       ：什麼都不做
 *   DELIVER_ACK  ：驗簽，通過才採信；是自己的求救就標記送達，否則繼續往外傳播
 *   UPLOAD       ：本機有網路，直接幫忙上傳
 *   RELAY        ：本機沒網路，存進待轉發佇列，等遇到下一個人
 */
function buildRelayContext(): RelayContext {
  return {
    isOnline: navigator.onLine,
    batteryLevel: currentBatteryLevel,
    localId: getLocalId(),
    myPendingSosIds,
    hasSeen: (msgId) => relayStore.hasSeen(msgId),
  };
}

async function handleIncomingPacket(packetBytes: Uint8Array): Promise<void> {
  const packet = decodePacket(packetBytes);
  if (!packet) return; // 格式不合法，不可信來源，直接丟棄

  const action = decideAction(packet, buildRelayContext());

  switch (action) {
    case RelayAction.DROP_DUPLICATE:
    case RelayAction.DROP_TTL_EXPIRED:
    case RelayAction.DROP_LOW_BATTERY:
      return;

    case RelayAction.DELIVER_ACK: {
      const ack = await verifyAck(packet.body);
      if (!ack) return; // 驗簽失敗——不可信的 ACK，寧可不採信也不能被偽造的「已送達」騙過

      relayStore.markSeen(packet.header.msgId);

      if (isAckForMe(ack.refId, buildRelayContext())) {
        myPendingSosIds.delete(ack.refId);
        setStatus(ack.refId, "delivered");
        return;
      }

      // 不是回給我的 ACK：我只是中繼者，繼續往外傳，並把對應的待轉發封包移除
      // （後端已經收到了，不必再有人幫忙轉那則原始求救）
      relayStore.remove(ack.refId);
      const forwarded = decrementForRelay(packet);
      if (forwarded) relayStore.enqueue(forwarded);
      return;
    }

    case RelayAction.UPLOAD:
      relayStore.markSeen(packet.header.msgId);
      await uploadPacket(packet);
      return;

    case RelayAction.RELAY: {
      relayStore.markSeen(packet.header.msgId);
      const forwarded = decrementForRelay(packet);
      if (forwarded) relayStore.enqueue(forwarded);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// 背景掃描：常駐尋找附近裝置，找到就嘗試把待轉發佇列遞出去
// ---------------------------------------------------------------------------

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

const base64ToBytes = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** 把待轉發佇列裡的每個封包都送給某個裝置一次（見檔案開頭的 MVP 簡化說明） */
async function flushPendingTo(deviceId: string): Promise<void> {
  for (const packet of relayStore.getPending()) {
    const res = await sendSos(deviceId, encodePacket(packet));
    if (!res.success) continue;

    // 自己的求救在收到 ACK 前持續保留、每次遇到新裝置都再送一次；
    // 其他（純中繼）封包送過一次就視為完成，從佇列移除。
    if (!myPendingSosIds.has(packet.header.msgId)) {
      relayStore.remove(packet.header.msgId);
    }
  }
}

/** 立刻掃一輪附近裝置，找到任何一個同 App 用戶就嘗試遞送待轉發佇列 */
async function tryFlushToAnyNearbyPeer(): Promise<void> {
  if (relayStore.pendingCount === 0) return;
  await scanNearby({
    onlyGuardiaUsers: true,
    durationMs: 4000,
    onDevice: (device) => {
      void flushPendingTo(device.deviceId);
    },
  });
}

async function backgroundScanTick(): Promise<void> {
  currentBatteryLevel = (await readBatteryLevel()) ?? currentBatteryLevel;
  const interval = scanIntervalForBattery(currentBatteryLevel);

  if (interval > 0) {
    await scanNearby({
      onlyGuardiaUsers: true,
      durationMs: Math.min(8000, interval),
      onDevice: (device) => {
        void flushPendingTo(device.deviceId);
      },
    }).catch(() => {});
  }

  backgroundScanTimer = setTimeout(() => void backgroundScanTick(), Math.max(interval, 15_000));
}

/**
 * 啟動 SOS 中繼引擎；App 啟動時呼叫一次即可，重複呼叫為 no-op。
 *
 * 沒設定後端金鑰時仍會啟動背景掃描（幫別人中繼不需要自己的金鑰），
 * 只有 submitSos（自己發求救）會因為沒有金鑰而拒絕。
 */
export async function initSosRelay(): Promise<void> {
  if (initialized) return;
  initialized = true;

  await subscribeSosPackets((packetBytes) => {
    void handleIncomingPacket(packetBytes);
  });

  void backgroundScanTick();
}

/** 停止背景掃描（測試或登出時使用） */
export function stopSosRelay(): void {
  if (backgroundScanTimer) clearTimeout(backgroundScanTimer);
  backgroundScanTimer = null;
  initialized = false;
}
