import { Capacitor } from "@capacitor/core";
import {
  CapacitorSQLite,
  SQLiteConnection,
  SQLiteDBConnection,
} from "@capacitor-community/sqlite";
import { BACKEND } from "./backend";
import { UserStatus } from "../types";

export interface UserStatusSyncRecord {
  id: string;
  user_id?: string | null;
  heart_rate: number;
  battery_level: number;
  latitude?: number | null;
  longitude?: number | null;
  client_timestamp: string;
}

const DB_NAME = "guardia_ai_local";
const FALLBACK_KEY = "pending_user_status_records";

let sqliteConnection: SQLiteConnection | null = null;
let dbConnection: SQLiteDBConnection | null = null;
let initPromise: Promise<SQLiteDBConnection | null> | null = null;

const isNativeSQLite = () => Capacitor.getPlatform() !== "web";

export async function saveUserStatusSnapshot(status: UserStatus) {
  const record: UserStatusSyncRecord = {
    id: createRecordId(),
    user_id: "local-user",
    heart_rate: status.heartRate,
    battery_level: status.batteryLevel,
    latitude: status.location?.lat ?? null,
    longitude: status.location?.lng ?? null,
    client_timestamp: new Date().toISOString(),
  };

  await savePendingUserStatus(record);
  return record;
}

export async function savePendingUserStatus(record: UserStatusSyncRecord) {
  if (!isNativeSQLite()) {
    const records = getFallbackRecords();
    records.push(record);
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(records));
    return;
  }

  const db = await getDb();
  if (!db) return;

  await db.run(
    `INSERT INTO pending_user_status (
      id,
      user_id,
      heart_rate,
      battery_level,
      latitude,
      longitude,
      client_timestamp,
      sync_status,
      retry_count,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
    [
      record.id,
      record.user_id ?? null,
      record.heart_rate,
      record.battery_level,
      record.latitude ?? null,
      record.longitude ?? null,
      record.client_timestamp,
      new Date().toISOString(),
    ],
  );
}

export async function getPendingUserStatusRecords(): Promise<UserStatusSyncRecord[]> {
  if (!isNativeSQLite()) {
    return getFallbackRecords();
  }

  const db = await getDb();
  if (!db) return [];

  const result = await db.query(
    `SELECT id, user_id, heart_rate, battery_level, latitude, longitude, client_timestamp
     FROM pending_user_status
     WHERE sync_status = 'pending'
     ORDER BY created_at ASC
     LIMIT 100`,
  );

  return (result.values || []).map((row: any) => ({
    id: String(row.id),
    user_id: row.user_id ?? null,
    heart_rate: Number(row.heart_rate),
    battery_level: Number(row.battery_level),
    latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
    longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
    client_timestamp: String(row.client_timestamp),
  }));
}

export async function syncPendingUserStatusRecords() {
  const pending = await getPendingUserStatusRecords();
  if (pending.length === 0) {
    return { success: true, synced: 0 };
  }

  try {
    const response = await fetch(`${BACKEND}/api/sync/bulk_status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        records: pending.map((record) => ({
          user_id: record.user_id,
          heart_rate: record.heart_rate,
          battery_level: record.battery_level,
          latitude: record.latitude,
          longitude: record.longitude,
          client_timestamp: record.client_timestamp,
        })),
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    await markUserStatusRecordsSynced(pending.map((record) => record.id));
    return { success: true, synced: pending.length };
  } catch (error) {
    await markUserStatusRecordsFailed(
      pending.map((record) => record.id),
      error instanceof Error ? error.message : "同步失敗",
    );
    return {
      success: false,
      synced: 0,
      error: error instanceof Error ? error.message : "同步失敗",
    };
  }
}

async function markUserStatusRecordsSynced(ids: string[]) {
  if (ids.length === 0) return;

  if (!isNativeSQLite()) {
    const synced = new Set(ids);
    const records = getFallbackRecords().filter((record) => !synced.has(record.id));
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(records));
    return;
  }

  const db = await getDb();
  if (!db) return;

  const placeholders = ids.map(() => "?").join(",");
  await db.run(
    `UPDATE pending_user_status
     SET sync_status = 'synced', synced_at = ?, updated_at = ?
     WHERE id IN (${placeholders})`,
    [new Date().toISOString(), new Date().toISOString(), ...ids],
  );
}

async function markUserStatusRecordsFailed(ids: string[], error: string) {
  if (ids.length === 0 || !isNativeSQLite()) return;

  const db = await getDb();
  if (!db) return;

  const placeholders = ids.map(() => "?").join(",");
  await db.run(
    `UPDATE pending_user_status
     SET retry_count = retry_count + 1, last_error = ?, updated_at = ?
     WHERE id IN (${placeholders})`,
    [error, new Date().toISOString(), ...ids],
  );
}

async function getDb() {
  if (dbConnection) return dbConnection;
  if (initPromise) return initPromise;

  initPromise = initDb();
  return initPromise;
}

async function initDb() {
  sqliteConnection = new SQLiteConnection(CapacitorSQLite);

  const db = await sqliteConnection.createConnection(
    DB_NAME,
    false,
    "no-encryption",
    1,
    false,
  );

  await db.open();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pending_user_status (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT,
      heart_rate INTEGER NOT NULL,
      battery_level REAL NOT NULL,
      latitude REAL,
      longitude REAL,
      client_timestamp TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      synced_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pending_user_status_sync
      ON pending_user_status(sync_status, created_at);
  `);

  dbConnection = db;
  return db;
}

function getFallbackRecords(): UserStatusSyncRecord[] {
  try {
    return JSON.parse(localStorage.getItem(FALLBACK_KEY) || "[]");
  } catch {
    return [];
  }
}

function createRecordId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
