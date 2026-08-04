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
<<<<<<< HEAD

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
=======
>>>>>>> 58fdbf595c177e942c8e1e94f609c964f5121f17
