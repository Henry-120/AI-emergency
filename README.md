<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/temp/3

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Backend with Cloud Firestore

The app still keeps its local SQLite/localStorage cache so emergency features
continue to work offline. When connectivity returns, the FastAPI backend now
persists accounts, medical cards, emergency reports/chat history, and user status
snapshots in Cloud Firestore instead of the Docker SQLite volume.

1. In Firebase Console, open **Project settings > Service accounts** and choose
   **Generate new private key**.
2. Save the downloaded file as `firebase-service-account.json` in the repository
   root. This filename is ignored by Git; never commit the key.
3. Copy `.env.example` to `.env.local`, set `FIREBASE_PROJECT_ID` to the Firebase
   project ID (not its display name), and replace `AUTH_SECRET`.
4. Start the backend with `docker compose up --build backend`.

Docker mounts the service-account file read-only at
`/run/secrets/firebase-service-account.json`. Firestore collections are created
automatically after the first register/sync request; there is no need to click
**Add collection** in the Firebase Console.

Existing data in the old Docker SQLite volume is not automatically migrated. It
is left untouched so it can be migrated or archived separately.

### 現場災情回報圖層

救援任務地圖可切換「求救案件」與依類型著色的「災情區域」圖層。災情顯示附近 50 公里、最近 24 小時，最多 300 筆（依伺服器收到時間排序）。需登入；查詢介面不回傳回報者帳號、姓名、心率或電量。原文仍可能含有使用者自行輸入的個資，僅供登入後查看。

`POST /api/earthquake/field-report` 先保存原始資料，再於背景透過既有 `GEMINI_API_KEY` / `GEMINI_MODEL` 整理類型、摘要、影響及位置描述。AI 整理失敗時保留原文；既有回報也可直接顯示原文。背景工作目前沒有持久化重試，程序中斷可能使回報停在「整理中」，但不影響原文查閱。

`GET /api/earthquake/field-reports/nearby?latitude=25&longitude=121&radius_km=50` 提供地圖資料，半徑限制為 0–100 公里（不含 0）。時間篩選使用 Firestore `server_timestamp` 單欄索引，不需複合索引。

所有回報固定標示「未查證」。半透明區域依類型使用道路橘色、建物紫色、火災紅色、民生設施藍色與其他觀察灰色，填色與邊框一致；區域以回報者 GPS 為中心、半徑 300 公尺，僅為顯示用示意範圍，不是已確認的災區邊界；點擊區域可查看回報摘要、時間與編號，重疊區域會列出各筆回報；原文可在列表展開查看。第一版不自動合併事件、不把回報數量當成查證結果，也不產生道路安全判定。部署後端並重新建置前端後才會生效；iOS 需同步前端資產至原生專案。
