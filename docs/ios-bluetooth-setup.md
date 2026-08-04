# iOS 藍牙功能：建置與實機測試指南

## 先講結論

**是的，一定要 Xcode，而且一定要 Mac。**

Xcode 只在 macOS 上執行。iOS App 的編譯、Swift 原生 plugin、簽章、安裝到實機——沒有任何一步能在 Windows 上完成。這不是設定問題，是 Apple 的限制，沒有繞路。

而且**藍牙在 iOS 模擬器上完全不能用**（模擬器沒有藍牙硬體）。要測藍牙，必須用實體 iPhone。

---

## 你需要準備

| 項目 | 說明 |
|------|------|
| 一台 Mac | 借學校電腦教室、實驗室的 Mac 都可以；不必是自己的 |
| Xcode | 從 App Store 免費安裝 |
| Apple ID | 免費帳號即可安裝到自己的裝置（憑證 7 天到期，重簽即可） |
| 實體 iPhone | 至少 2 支才能測 App 之間的傳訊；SOS 中繼需要 3 支 |

---

## 建置步驟（在 Mac 上）

```bash
git clone <repo>
cd AI-emergency
npm install
npm run build          # 先產出 dist/，Capacitor 會把它複製進 iOS App
npx cap sync ios       # 同步原生依賴與 web 資源
npx cap open ios       # 用 Xcode 開啟 ios/App/App.xcworkspace
```

### 首次開啟後，必須手動做的一件事

**把藍牙的 Swift 檔加入 Xcode 專案。**

`ios/App/App/BluetoothPeripheral/` 底下的兩個 Swift 檔目前**不在 Xcode 專案裡**
（`project.pbxproj` 完全沒有引用它們）。它們存在於 git 中，但 Xcode 不會編譯，
所以 `registerPlugin("BlePeripheral")` 在 iOS 上只會拿到空殼，廣播不會運作。

在 Xcode 中：

1. 在左側專案樹中對 `App` 群組按右鍵 → **Add Files to "App"…**
2. 選取 `ios/App/App/BluetoothPeripheral` 資料夾
3. 勾選 **Copy items if needed 取消**（檔案已在專案目錄內）、
   **Create groups**、Target 勾選 **App**
4. 加入後，確認 Build Phases → Compile Sources 中出現
   `BlePeripheralManager.swift` 與 `BlePeripheralPlugin.swift`

完成後請 **把 `ios/App/App.xcodeproj/project.pbxproj` 一起 commit**，
否則下一個人在別台 Mac 上還要再做一次。

### 簽章

1. Xcode → 選 `App` target → **Signing & Capabilities**
2. **Team** 選你的 Apple ID（沒有的話點 Add an Account）
3. **Bundle Identifier** 改成獨一無二的字串（例如 `com.你的名字.guardiaai`）

### 執行

1. 用線接上 iPhone，在 Xcode 左上角的裝置選單選擇你的實機（**不要選 Simulator**）
2. 按 ▶ Run
3. iPhone 第一次會拒絕執行 → 到 **設定 → 一般 → VPN 與裝置管理** 信任你的開發者憑證

---

## 藍牙權限

`Info.plist` 已含必要的權限描述（缺少的話 App 一碰藍牙就會被 iOS 直接終止）：

- `NSBluetoothAlwaysUsageDescription`
- `NSBluetoothPeripheralUsageDescription`

App 首次使用藍牙時會跳出授權對話框。若不小心按了拒絕，要到
**設定 → 隱私權與安全性 → 藍牙** 重新開啟。

---

## 測試藍牙功能

### 兩支手機：基本收發

1. 兩支手機都安裝 App、都開啟藍牙
2. 兩邊都進入「附近的人」，各自按 **讓附近的人看見我**
3. 幾秒內雙方應在列表中看到對方（顯示對方的 6 字元識別碼）
4. 點 **傳訊息**，送出一則訊息
5. 對方應收到；**離開頁面再回來，訊息仍在**（收件匣是常駐且持久化的）

### 必須在實機上驗證的項目

以下行為在單元測試中**無法驗證**，只有實機能證明：

- 廣播能被對方掃到（`CBPeripheralManager` 的啟動流程）
- `didReceiveWrite` 的回應修正（原本對每個 request 都 respond，屬 API 誤用）
- notify 推送佇列（需要對方訂閱特徵值）
- 掃描的取消與連線複用
- 長訊息的分片與重組（傳一則超過 200 字的中文訊息即可驗證）

### 已知限制

- **App 進入背景後，iOS 會剝除廣播中的識別碼**，對方掃得到裝置但認不出是誰。
  目前只支援前景使用。
- **Android 無法廣播**：peripheral 是 iOS 原生實作。Android 只能掃描與接收。
- `MAX_FRAME_BYTES` 目前保守設為 180。實機測出安全上限後可調高
  （見 `src/services/bluetooth/bluetoothConstants.ts`）。

---

## 沒有 Mac 怎麼辦？

短期沒有 Mac 的話，可以先做這些不需要 iOS 的事：

- 純函式邏輯：`npm test`（封包驗證、分片重組、去重、識別碼——37 個測試）
- UI 版面與文案：`npm run dev` 在瀏覽器中檢視（藍牙功能本身會顯示
  「需要在手機 App 中使用」，這是正確行為）
- SOS 中繼協定的設計與實作（協定邏輯可完全以單元測試驅動）

但**任何藍牙行為的驗證，最終都必須回到 Mac + 實機**。
