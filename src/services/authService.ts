import { AuthUser } from "../types";
import { BACKEND } from "./backend";

/**
 * 離線優先的認證服務。
 *
 * 緊急應變 App 必須在無網路時仍能登入並讀取醫療卡，因此帳號資料以 localStorage
 * 為主要來源（密碼使用 Web Crypto PBKDF2 雜湊，不存明碼）。當有網路時，會盡力
 * 與後端同步註冊 / 登入並保存後端 token，供醫療卡跨裝置同步使用。
 */

const USERS_KEY = "guardia_users";
const SESSION_KEY = "guardia_session";
const BACKEND_TOKEN_KEY = "guardia_backend_token";
const BACKEND_TIMEOUT_MS = 5000;

interface StoredUser extends AuthUser {
  passwordHash: string; // 格式： <saltHex>:<hashHex>
}

interface Session {
  user: AuthUser;
}

interface BackendUser {
  id: string;
  username: string;
  email?: string | null;
  created_at: string;
}

interface BackendAuthResponse {
  token: string;
  user: BackendUser;
}

// ---------- localStorage 讀寫 ----------
function loadUsers(): StoredUser[] {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveUsers(users: StoredUser[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function toAuthUser(user: BackendUser): AuthUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email || undefined,
    createdAt: user.created_at,
  };
}

// ---------- 密碼雜湊 (Web Crypto PBKDF2-SHA256) ----------
function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

async function derive(password: string, salt: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("此連線環境無法安全處理密碼，請改用 HTTPS 或 localhost 開啟應用程式");
  }
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return toHex(bits);
}

async function hashPassword(password: string): Promise<string> {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("此連線環境無法安全處理密碼，請改用 HTTPS 或 localhost 開啟應用程式");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt);
  return `${toHex(salt.buffer)}:${hash}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const candidate = await derive(password, fromHex(saltHex));
  return candidate === hashHex;
}

// ---------- Session ----------
export function getCurrentUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return (JSON.parse(raw) as Session).user;
  } catch {
    return null;
  }
}

export function isLoggedIn(): boolean {
  return getCurrentUser() !== null;
}

function setSession(user: AuthUser) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ user } as Session));
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(BACKEND_TOKEN_KEY);
}

export function getBackendToken(): string | null {
  return localStorage.getItem(BACKEND_TOKEN_KEY);
}

/** 線上時驗證伺服器 session；離線時才接受本機 session。 */
export async function validateSession(): Promise<AuthUser | null> {
  const localUser = getCurrentUser();
  if (!navigator.onLine) return localUser;

  const token = getBackendToken();
  if (!token) return null;
  try {
    const response = await fetchBackend("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const user = toAuthUser((await response.json()) as BackendUser);
    setSession(user);
    return user;
  } catch {
    return null;
  }
}

// ---------- 後端最佳努力同步 ----------
async function fetchBackend(path: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

  try {
    return await fetch(`${BACKEND}${path}`, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function readBackendError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  if (typeof body?.detail === "string") return body.detail;
  if (response.status === 409) return "姓名或 Email 已被註冊";
  if (response.status === 401) return "姓名或密碼錯誤";
  return `伺服器錯誤（HTTP ${response.status}）`;
}

async function backendRegister(
  username: string,
  password: string,
  email?: string,
): Promise<BackendAuthResponse> {
  const res = await fetchBackend("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, email }),
  });
  if (!res.ok) throw new Error(await readBackendError(res));
  return res.json() as Promise<BackendAuthResponse>;
}

async function backendLogin(
  username: string,
  password: string,
): Promise<BackendAuthResponse> {
  const res = await fetchBackend("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(await readBackendError(res));
  return res.json() as Promise<BackendAuthResponse>;
}

async function cacheOnlineAccount(data: BackendAuthResponse, password: string): Promise<AuthUser> {
  const user = toAuthUser(data.user);
  const passwordHash = await hashPassword(password);
  const users = loadUsers().filter(
    (item) =>
      item.id !== user.id &&
      item.username.toLowerCase() !== user.username.toLowerCase(),
  );
  users.push({ ...user, passwordHash });
  saveUsers(users);
  localStorage.setItem(BACKEND_TOKEN_KEY, data.token);
  setSession(user);
  return user;
}

// ---------- 對外 API ----------
export interface AuthResult {
  success: boolean;
  user?: AuthUser;
  error?: string;
}

export async function register(
  username: string,
  password: string,
  email?: string,
): Promise<AuthResult> {
  const name = username.trim();
  const mail = (email || "").trim();
  if (name.length < 2) return { success: false, error: "姓名至少需 2 個字元" };
  if (password.length < 6) return { success: false, error: "密碼至少需 6 個字元" };

  if (navigator.onLine) {
    try {
      const data = await backendRegister(name, password, mail || undefined);
      const user = await cacheOnlineAccount(data, password);
      return { success: true, user };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "線上註冊失敗，請稍後再試",
      };
    }
  }

  const users = loadUsers();
  if (users.some((u) => u.username.toLowerCase() === name.toLowerCase())) {
    return { success: false, error: "此姓名已被註冊" };
  }
  if (mail && users.some((u) => (u.email || "").toLowerCase() === mail.toLowerCase())) {
    return { success: false, error: "此 Email 已被註冊" };
  }

  const user: AuthUser = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    username: name,
    email: mail || undefined,
    createdAt: new Date().toISOString(),
  };
  const passwordHash = await hashPassword(password);
  users.push({ ...user, passwordHash });
  saveUsers(users);
  setSession(user);
  return { success: true, user };
}

export async function login(username: string, password: string): Promise<AuthResult> {
  const name = username.trim();

  if (navigator.onLine) {
    try {
      const data = await backendLogin(name, password);
      const user = await cacheOnlineAccount(data, password);
      return { success: true, user };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "線上登入失敗，請稍後再試",
      };
    }
  }

  const users = loadUsers();
  const found = users.find((u) => u.username.toLowerCase() === name.toLowerCase());
  if (!found) return { success: false, error: "姓名或密碼錯誤" };

  const ok = await verifyPassword(password, found.passwordHash);
  if (!ok) return { success: false, error: "姓名或密碼錯誤" };

  const user: AuthUser = {
    id: found.id,
    username: found.username,
    email: found.email,
    createdAt: found.createdAt,
  };
  setSession(user);
  return { success: true, user };
}
