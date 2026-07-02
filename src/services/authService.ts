import { AuthUser } from "../types";
import { auth, db, isFirebaseConfigured } from "./firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  User,
} from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

/**
 * 以 Firebase Authentication 管理帳號（雲端、跨裝置）。
 * - 帳號密碼登入使用 Email 作為憑證，姓名(displayName)另存為顯示名稱。
 * - Firebase 會把登入狀態保存在本機，登入後即使離線也維持登入。
 */

// 讓登入狀態持久化於本機（關閉瀏覽器後仍保持登入）。
if (isFirebaseConfigured) {
  setPersistence(auth, browserLocalPersistence).catch(() => {});
}

function toAuthUser(u: User): AuthUser {
  return {
    id: u.uid,
    username: u.displayName || u.email || "使用者",
    email: u.email || undefined,
    createdAt: u.metadata.creationTime || new Date().toISOString(),
  };
}

/** 訂閱登入狀態變化，回傳取消訂閱函式。 */
export function subscribeAuth(cb: (user: AuthUser | null) => void): () => void {
  if (!isFirebaseConfigured) {
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(auth, (u) => cb(u ? toAuthUser(u) : null));
}

export function getCurrentUser(): AuthUser | null {
  const u = isFirebaseConfigured ? auth.currentUser : null;
  return u ? toAuthUser(u) : null;
}

export function isLoggedIn(): boolean {
  return getCurrentUser() !== null;
}

export async function logout(): Promise<void> {
  if (isFirebaseConfigured) {
    await signOut(auth);
  }
}

export interface AuthResult {
  success: boolean;
  user?: AuthUser;
  error?: string;
}

// 將 Firebase 錯誤代碼轉成中文訊息。
function messageFor(code: string): string {
  switch (code) {
    case "auth/email-already-in-use":
      return "此 Email 已被註冊";
    case "auth/invalid-email":
      return "Email 格式不正確";
    case "auth/weak-password":
      return "密碼強度不足，至少需 6 個字元";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Email 或密碼錯誤";
    case "auth/too-many-requests":
      return "嘗試次數過多，請稍後再試";
    case "auth/network-request-failed":
      return "網路連線失敗，請檢查網路";
    default:
      return "發生錯誤，請再試一次";
  }
}

export async function register(
  username: string,
  password: string,
  email?: string,
): Promise<AuthResult> {
  if (!isFirebaseConfigured) {
    return { success: false, error: "尚未設定 Firebase，請聯絡開發者" };
  }
  const name = username.trim();
  const mail = (email || "").trim();
  if (name.length < 2) return { success: false, error: "姓名至少需 2 個字元" };
  if (!mail) return { success: false, error: "請輸入 Email" };
  if (password.length < 6) return { success: false, error: "密碼至少需 6 個字元" };

  try {
    const cred = await createUserWithEmailAndPassword(auth, mail, password);
    await updateProfile(cred.user, { displayName: name });
    // 在 Firestore 建立使用者資料 + 一張空白醫療卡的擁有者記錄
    await setDoc(
      doc(db, "users", cred.user.uid),
      { username: name, email: mail, createdAt: serverTimestamp() },
      { merge: true },
    );
    return { success: true, user: toAuthUser(cred.user) };
  } catch (e: any) {
    return { success: false, error: messageFor(e?.code || "") };
  }
}

export async function login(email: string, password: string): Promise<AuthResult> {
  if (!isFirebaseConfigured) {
    return { success: false, error: "尚未設定 Firebase，請聯絡開發者" };
  }
  const mail = email.trim();
  if (!mail || !password) return { success: false, error: "請輸入 Email 與密碼" };

  try {
    const cred = await signInWithEmailAndPassword(auth, mail, password);
    return { success: true, user: toAuthUser(cred.user) };
  } catch (e: any) {
    return { success: false, error: messageFor(e?.code || "") };
  }
}
