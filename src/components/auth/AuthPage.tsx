import React, { useState } from "react";
import { AuthUser } from "../../types";
import { login, register } from "../../services/authService";

type Mode = "login" | "register";

/** 版面回到最初的結構（置中 Logo、分頁切換、欄位標籤在上）。 */
export function AuthPage({ onAuthed }: { onAuthed: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError("");

    if (mode === "register" && password !== confirm) {
      setError("兩次輸入的密碼不一致");
      return;
    }

    setBusy(true);
    try {
      const result =
        mode === "login"
          ? await login(username, password)
          : await register(username, password, email);

      if (result.success && result.user) {
        onAuthed(result.user);
      } else {
        setError(result.error || "發生未知錯誤，請再試一次");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "發生未知錯誤，請再試一次";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError("");
    setPassword("");
    setConfirm("");
  };

  const FIELD =
    "w-full px-4 py-3 rounded-xl bg-surface border border-line text-ink text-base sm:text-sm focus:outline-none focus:border-accent transition-colors placeholder:text-muted";

  return (
    <div className="grad-canvas h-[100dvh] min-h-0 flex flex-col items-center text-ink px-4 sm:px-6 overflow-y-auto overscroll-contain safe-area-top safe-area-bottom">
      <div className="my-auto w-full max-w-sm py-5 sm:py-8">
        {/* Logo */}
        <div className="flex flex-col items-center mb-5 sm:mb-8">
          <div className="grad-05 w-14 h-14 rounded-2xl flex items-center justify-center shadow-[var(--elev-2)] mb-3">
            <i className="fas fa-shield-alt text-white text-xl"></i>
          </div>
          <span className="font-bold text-2xl tracking-tight">
            Guardia<span className="text-accent">AI</span>
          </span>
          <p className="text-xs text-muted mt-1">智慧災害應變系統</p>
        </div>

        {/* 分頁切換 */}
        <div className="flex bg-surface-2 rounded-xl p-1 mb-6">
          <button
            type="button"
            onClick={() => switchMode("login")}
            className={`min-h-11 flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              mode === "login"
                ? "grad-action text-white"
                : "text-muted hover:text-ink"
            }`}
          >
            登入
          </button>
          <button
            type="button"
            onClick={() => switchMode("register")}
            className={`min-h-11 flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              mode === "register"
                ? "grad-action text-white"
                : "text-muted hover:text-ink"
            }`}
          >
            註冊
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="auth-username" className="block text-xs text-muted mb-1.5">
              姓名
            </label>
            <input
              id="auth-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="請輸入姓名"
              className={FIELD}
            />
          </div>

          {mode === "register" && (
            <div>
              <label htmlFor="auth-email" className="block text-xs text-muted mb-1.5">
                Email <span className="text-muted">(選填)</span>
              </label>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="example@mail.com"
                className={FIELD}
              />
            </div>
          )}

          <div>
            <label htmlFor="auth-password" className="block text-xs text-muted mb-1.5">
              密碼
            </label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="至少 6 個字元"
              className={FIELD}
            />
          </div>

          {mode === "register" && (
            <div>
              <label htmlFor="auth-confirm" className="block text-xs text-muted mb-1.5">
                確認密碼
              </label>
              <input
                id="auth-confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                placeholder="再次輸入密碼"
                className={FIELD}
              />
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="text-xs text-critical-text bg-critical-soft border border-critical px-3 py-2 rounded-lg"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="grad-action min-h-11 w-full py-3 rounded-xl text-white font-bold text-sm transition-all active:scale-[0.99] disabled:opacity-50"
          >
            {busy ? "處理中..." : mode === "login" ? "登入" : "建立帳號"}
          </button>
        </form>

        <p className="text-[11px] text-muted text-center mt-6 leading-relaxed">
          姓名與醫療卡資料會安全地儲存在本機，
          <br />
          即使在無網路的災害現場也能使用。
        </p>
      </div>
    </div>
  );
}
