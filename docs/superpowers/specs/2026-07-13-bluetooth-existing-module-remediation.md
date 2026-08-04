# 現有藍牙模組 — 優化方案

日期：2026-07-13
對象：`src/services/bluetooth/`、`src/components/bluetooth/`、`ios/App/App/BluetoothPeripheral/`
關聯文件：[藍牙 SOS 多跳中繼網路設計](./2026-07-13-bluetooth-sos-relay-design.md)

本文件列出現有藍牙模組的 18 項問題與對應修復方案。分階段執行；階段 0 與 1 是 SOS 中繼的必要前置。

---

## 階段 0 — 原生層 Bug（獨立可測，最優先）

### 0.1 `didReceiveWrite` 對每個 request 都回應（API 誤用）

**問題**：`BlePeripheralManager.swift` 在 for 迴圈內對每個 `CBATTRequest` 呼叫 `respond(to:withResult:)`。CoreBluetooth 要求**只對陣列中的第一個 request 回應一次**；多次呼叫屬 API 誤用。

**修復**：迴圈內只處理資料，迴圈外統一回應一次。

```swift
func peripheralManager(_ peripheral: CBPeripheralManager,
                       didReceiveWrite requests: [CBATTRequest]) {
    guard let first = requests.first else { return }

    for request in requests {
        guard request.characteristic.uuid == BlePeripheralManager.INBOX_CHAR_UUID,
              let value = request.value else { continue }
        onMessageReceived?(value, request.central.identifier.uuidString)
    }

    // 只對第一個 request 回應一次
    peripheralManager.respond(to: first, withResult: .success)
}
```

### 0.2 characteristic 宣告 `.read` 卻無 `didReceiveRead`

**問題**：`addService()` 設定 `.read` property 與 `.readable` permission，且 `value: nil`。CoreBluetooth 規則為：`value` 為 nil 時，Central 讀取會觸發 `peripheralManager(_:didReceiveRead:)`；該 delegate 未實作，讀取請求永不被回應，對方逾時卡住。

**修復**：目前架構不需要 read，先移除該能力。未來若要對外暴露緊急醫療摘要，再實作 `didReceiveRead`。

```swift
inboxCharacteristic = CBMutableCharacteristic(
    type: BlePeripheralManager.INBOX_CHAR_UUID,
    properties: [.write, .writeWithoutResponse, .notify],
    value: nil,
    permissions: [.writeable]
)
```

### 0.3 `.notify` 宣告了但從未使用

**問題**：characteristic 帶 `.notify`，但 Swift 端從未呼叫 `updateValue(...)`。Peripheral 無法主動推訊息回 Central，導致「對話」實為兩條各自獨立的單向通道。

**修復**：實作訂閱名單與推送佇列。注意 `updateValue` 在傳輸佇列滿時回傳 `false`，必須在 `peripheralManagerIsReady(toUpdateSubscribers:)` 中補送，否則訊息會靜默遺失。

```swift
private var pendingNotifications: [Data] = []

func peripheralManager(_ p: CBPeripheralManager, central: CBCentral,
                       didSubscribeTo characteristic: CBCharacteristic) {
    flushPendingNotifications()
}

/// 主動推訊息給已訂閱的 Central
func notify(data: Data) {
    pendingNotifications.append(data)
    flushPendingNotifications()
}

private func flushPendingNotifications() {
    while let next = pendingNotifications.first {
        // updateValue 回傳 false = 傳輸佇列已滿，停止並等 isReady 回呼
        let sent = peripheralManager.updateValue(
            next, for: inboxCharacteristic, onSubscribedCentrals: nil
        )
        if !sent { return }
        pendingNotifications.removeFirst()
    }
}

func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
    flushPendingNotifications()
}
```

### 0.4 重複呼叫 `startAdvertising` 會讓 Promise 永遠卡住

**問題**：`BlePeripheralPlugin.swift` 直接覆寫 `manager.onAdvertisingStarted`。連點兩次「開始廣播」時，第一個 `CAPPluginCall` 的 callback 被覆蓋，其 JS Promise 永遠 pending，UI 卡死。

**修復**：以 `pendingStartCall` 做併發保護，並加逾時保險，確保 JS 端不會無限等待。

```swift
private var pendingStartCall: CAPPluginCall?

@objc func startAdvertising(_ call: CAPPluginCall) {
    guard pendingStartCall == nil else {
        call.reject("廣播啟動中，請稍候")
        return
    }
    let localId = call.getString("localId") ?? ""
    pendingStartCall = call

    manager.onAdvertisingStarted = { [weak self] error in
        guard let self, let pending = self.pendingStartCall else { return }
        self.pendingStartCall = nil
        if let error {
            pending.reject("廣播啟動失敗：\(error.localizedDescription)")
        } else {
            pending.resolve(["success": true, "localId": localId])
        }
    }

    // 逾時保險：藍牙權限被拒或狀態卡住時，避免 JS 永遠等待
    DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
        guard let self, let pending = self.pendingStartCall else { return }
        self.pendingStartCall = nil
        pending.reject("廣播啟動逾時，請確認藍牙已開啟並已授權")
    }

    manager.startAdvertising(localId: localId)
}
```

### 0.5 `keepAlive` 的 call 從未釋放（記憶體洩漏）

**問題**：`call.keepAlive = true` 已設定，但 resolve 後從未釋放，每次啟動廣播就洩漏一個 call。此處為一次性回覆，本就不需要 `keepAlive`（`CAPPluginCall` 在 resolve/reject 前本來就存活）。

**修復**：移除 `call.keepAlive = true`。0.4 的 `pendingStartCall` 已負責持有 call 直到回呼。

---

## 階段 1 — TypeScript 服務層（中繼的必要前置）

### 1.1 訊息接收必須常駐，不能綁在頁面生命週期

**問題**：`NearbyPeoplePage.tsx` 於 mount 時 `subscribeMessages`、unmount 時 `unsubscribe()`。使用者一離開該頁面，所有他人傳來的訊息完全收不到也不留存。對災難 App 而言此為致命缺陷。

**修復**：新增模組級單例 `bluetoothInbox.ts`，在 App 啟動時初始化一次，訊息持久化，UI 僅訂閱其變化。

```ts
// src/services/bluetooth/bluetoothInbox.ts
import { subscribeMessages } from "./bluetoothService";
import type { IncomingMessage } from "./bluetoothTypes";

const STORAGE_KEY = "guardia.bluetooth.inbox";

let messages: IncomingMessage[] = load();
let unreadCount = 0;
let nativeUnsub: (() => void) | null = null;
const listeners = new Set<() => void>();

/** App 啟動時呼叫一次；重複呼叫為 no-op */
export async function initInbox(): Promise<void> {
  if (nativeUnsub) return;
  nativeUnsub = await subscribeMessages((msg) => {
    messages = [...messages, msg];
    unreadCount += 1;
    persist();
    listeners.forEach((l) => l());
  });
}

export function subscribeInbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getMessages(): IncomingMessage[] { return messages; }
export function getUnreadCount(): number { return unreadCount; }
export function markAllRead(): void {
  unreadCount = 0;
  listeners.forEach((l) => l());
}
```

於 `App.tsx` 的 `useEffect` 呼叫 `initInbox()` 一次（不在 cleanup 中取消）。`NearbyPeoplePage` 改為 `subscribeInbox()`，離開頁面只解除 UI 訂閱，原生訂閱維持存活。

### 1.2 收到的封包完全未驗證（做中繼後將成為攻擊面）

**問題**：`bluetoothPeripheral.ts` 的 `onMessageReceived` 將 `JSON.parse` 結果直接展開（`{...parsed, centralId}`）。缺欄位或型別錯誤的 payload 會讓 `ChatPanel` 的 `new Date(timestamp)`、`location.lat.toFixed(4)` 崩潰。**中繼上線後，封包來源將是任意陌生人。**

**修復**：加入型別守衛，驗證失敗即丟棄。

```ts
function isValidMessage(v: unknown): v is OutgoingMessage {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;

  if (typeof o.from !== "string" || o.from.length === 0 || o.from.length > 16) return false;
  if (typeof o.text !== "string" || o.text.length > 500) return false;
  if (typeof o.timestamp !== "number" || !Number.isFinite(o.timestamp)) return false;

  if (o.location !== undefined) {
    const loc = o.location as Record<string, unknown> | null;
    if (typeof loc !== "object" || loc === null) return false;
    if (typeof loc.lat !== "number" || loc.lat < -90 || loc.lat > 90) return false;
    if (typeof loc.lng !== "number" || loc.lng < -180 || loc.lng > 180) return false;
  }
  return true;
}
```

於 `onMessageReceived` 中：`JSON.parse` → `isValidMessage()` → 不合法則 `console.warn` 並 `return`，不得進入 UI 狀態。

### 1.3 掃描無法取消，且併發會互相踩

**問題**：`scanNearby()` 內部 `await` 一個 8 秒 `setTimeout` 後才 `stopLEScan()`。使用者按下掃描後立即返回，掃描仍持續空轉耗電，並對已卸載元件 setState。且 `stopLEScan()` 是全域的——兩個重疊的掃描會互相終止對方。

**修復**：改為可取消的介面，並在服務層做併發保護（不依賴 UI 的旗標）。

```ts
let activeScanAbort: (() => void) | null = null;

export async function scanNearby(opts: {
  onlyGuardiaUsers: boolean;
  durationMs?: number;
  signal?: AbortSignal;
  /** 掃到即回報，不必等整輪結束 */
  onDevice?: (device: NearbyDevice) => void;
}): Promise<NearbyDevice[]> {
  // 併發保護：新掃描開始前，先停掉上一輪
  activeScanAbort?.();
  ...
  // signal.addEventListener('abort', () => { stopLEScan(); resolve(current) })
}
```

### 1.4 掃描結果應即時串流，而非等 8 秒一次跳出

**問題**：目前掃 8 秒後才一次回傳整份快照。災難情境下，使用者盯著空白畫面 8 秒是不可接受的。

**修復**：搭配 1.3 的 `onDevice` callback，掃到一個就即時加入列表。UI 逐筆浮現。

### 1.5 `allowDuplicates: true` 導致大量無謂回呼

**問題**：掃描期間同一裝置每收到一個廣告封包就回呼一次，8 秒內可達數百次，每次都重建 Map。耗電且無意義。（`allowDuplicates` 必須為 true 才能更新 RSSI，不能直接關閉。）

**修復**：以 deviceId 為 key 做節流，同一裝置 500ms 內最多更新一次。

```ts
const lastEmitAt = new Map<string, number>();
const THROTTLE_MS = 500;

// 在 scan callback 中：
const now = Date.now();
const last = lastEmitAt.get(deviceId) ?? 0;
if (now - last < THROTTLE_MS) return;
lastEmitAt.set(deviceId, now);
```

### 1.6 `localId` 每次重開 App 就改變

**問題**：`generateLocalId()` 為 session-scoped（原註解已承認）。但對話歷史以 `localId` 為 key，重開 App 後所有對話對不起來，對方也認不出你是同一個人。

**修復**：持久化，並將長度從 4 字元提高到 6 字元（32⁴ ≈ 100 萬 → 32⁶ ≈ 10 億），大幅降低同場碰撞機率；廣播封包仍塞得下。

```ts
const LOCAL_ID_KEY = "guardia.bluetooth.localId";
const ID_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

export function getOrCreateLocalId(): string {
  const saved = localStorage.getItem(LOCAL_ID_KEY);
  if (saved && ID_PATTERN.test(saved)) return saved;
  const id = generateLocalId(6);
  localStorage.setItem(LOCAL_ID_KEY, id);
  return id;
}
```

### 1.7 藍牙狀態不會自動更新

**問題**：`status` 僅在進入頁面與切換廣播後刷新。使用者於系統設定關閉藍牙後，UI 仍顯示「廣播中」。

**修復**：由 `bluetoothInbox`（或另一個狀態模組）統一維護，以 3 秒週期輪詢 `getStatus()` 並通知訂閱者。UI 不再各自 poll。

### 1.8 瀏覽器環境的提示文案是錯的

**問題**：UI 顯示「瀏覽器環境無法廣播自己，僅能掃描」。但 iOS Safari 不支援 Web Bluetooth，**掃描同樣不可用**。此文案會誤導使用者以為功能仍部分可用。

**修復**：非原生環境時，明確顯示「此功能需要在 App 中使用」，並停用所有藍牙操作，而非只停用廣播按鈕。

---

## 階段 2 — UI 與文案（工作分配表明列的要求）

工作分配表要求：「搞清楚初始化、廣播那些是什麼意思並改寫讓沒這方面知識的使用者也看得懂」。

### 2.1 術語全面替換

**規則：介面上不得出現任何藍牙術語。**

| 現行文案 | 改為 |
|----------|------|
| 開始廣播 | 讓附近的人看見我 |
| 停止廣播 | 停止讓別人看見我 |
| 掃描附近 / 掃描中... (約 8 秒) | 正在尋找附近的人… |
| 我的代號 | 我的識別碼 |
| `RSSI -67 dBm` | 移除數值，只保留「非常近 / 近 / 中 / 遠」 |
| BLE 直連 · -67 dBm | 直接連線（不需網路） |
| 超出 BLE 單包上限，請縮短 | 訊息太長了，請縮短 |
| GuardiaAI 用戶 | 使用同一個 App 的人 |
| 藍牙初始化失敗 | 無法啟動附近功能，請確認藍牙已開啟 |

### 2.2 自動尋找，不要求使用者按「掃描」

**問題**：災難當下的使用者不應需要理解「我得先按掃描」。

**修復**：進入頁面即自動開始持續尋找（搭配 1.3 的可取消掃描與 1.4 的即時串流），按鈕語意反轉為「停止尋找」。

### 2.3 未讀訊息提示

**問題**：訊息只有在正好開著該對話時才看得到，主畫面完全無提示。

**修復**：`AppHeader` 的「附近的人」按鈕加上紅點與未讀數，資料來自 `bluetoothInbox.getUnreadCount()`。

### 2.4 移除「所有藍牙裝置」模式

**問題**：掃到耳機、手環對災難求生無用途，只會稀釋列表、增加使用者的判斷負擔。

**修復**：預設只顯示同 App 使用者。若要保留，收進「進階」選項，不放在主要動線上。

### 2.5 以字數取代 bytes 提示

**問題**：`ChatPanel` 顯示 `140 bytes` 上限。中文一字 3 bytes，實際僅能輸入約 46 字，但介面顯示的是使用者無法理解的 bytes 數。

**修復**：顯示「還可輸入 N 字」。上限於階段 3 撐開 MTU 後放寬。

---

## 階段 3 — 效能與傳輸

### 3.1 撐開單包上限（MTU）

**問題**：`MAX_MESSAGE_BYTES = 180` 是自行設定的保守值；註解引用的「GATT 預設 MTU 約 23 bytes」是 BLE 4.0 的舊數字。iPhone 對 iPhone 的 ATT MTU 通常可達 185–512 bytes。SOS 封包加密後約需 61 bytes 額外開銷加上 14 bytes 標頭，在 180 bytes 限制下塞不下。

**修復策略**（`@capacitor-community/bluetooth-le` 未必暴露 MTU 查詢，故採實測法）：

1. 於實機上以遞增長度實測 `BleClient.write()` 的成功上限，找出安全值。
2. 將 `MAX_MESSAGE_BYTES` 提高到實測值。
3. 實作分片（chunking）：超過上限的 payload 拆成多包，帶 `chunkIndex` / `chunkTotal`，接收端重組。
4. 分片重組需設逾時（例如 10 秒），避免不完整的分片永久佔用記憶體。

### 3.2 連線複用，不要每則訊息都重連

**問題**：`sendMessageTo()` 每次都 `connect → write → disconnect`（原註解已承認為 v1 取捨）。聊天時每則訊息重新連線，延遲顯著。

**修復**：連線池 + 閒置逾時。傳送後不立即斷線，保留 15 秒；期間再傳給同一對象即複用連線，逾時未用才斷開。

---

## 執行順序與理由

| 階段 | 內容 | 為何是這個順序 |
|------|------|----------------|
| 0 | 原生層 5 個 bug | 地基。獨立於其他改動，可單獨在實機驗證。不修好，上層行為無法信任 |
| 1 | 服務層常駐化、驗證、可取消掃描、持久化 ID | SOS 中繼的必要前置。1.1 與 1.2 尤其關鍵——中繼會讓「頁面才收訊」與「不驗證封包」從缺陷升級為致命傷 |
| 2 | UI 與文案 | 可與階段 1 並行；不阻擋任何技術工作 |
| 3 | MTU 與連線複用 | 加密後的 SOS 封包塞不進現有上限，故必須在中繼之前完成 |
| 4 | SOS 多跳中繼 | 見另一份設計文件 |

---

## 驗證方式

**可自動化測試（不需實機）**：1.2 的型別守衛、1.6 的 ID 生成與持久化、3.1 的分片切割與重組、1.5 的節流邏輯——皆可抽為純函式並以單元測試覆蓋。

**必須實機驗證**：階段 0 全部（CoreBluetooth 行為無法模擬）、1.3 的掃描取消、3.1 的 MTU 實測上限、3.2 的連線複用。

**必須雙機驗證**：0.3 的 notify 推送、訊息收發的端到端流程。
