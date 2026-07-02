import React, { useState } from "react";
import { AuthUser } from "../../types";
import { login, register } from "../../services/authService";

type Mode = "login" | "register";

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
    const result =
      mode === "login"
        ? await login(email, password)
        : await register(username, password, email);
    setBusy(false);

    if (result.success && result.user) {
      onAuthed(result.user);
    } else {
      setError(result.error || "發生未知錯誤，請再試一次");
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError("");
    setPassword("");
    setConfirm("");
  };

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-[#020617] px-6 overflow-y-auto">
      <div className="w-full max-w-sm py-8">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 bg-amber-500 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-500/20 mb-3">
            <i className="fas fa-shield-alt text-black text-xl"></i>
          </div>
          <span className="font-bold text-2xl tracking-tight">
            Guardia<span className="text-amber-500">AI</span>
          </span>
          <p className="text-xs text-slate-500 mt-1">智慧災害應變系統</p>
        </div>

        {/* 分頁切換 */}
        <div className="flex bg-slate-800/60 rounded-xl p-1 mb-6">
          <button
            type="button"
            onClick={() => switchMode("login")}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              mode === "login"
                ? "bg-amber-500 text-black"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            登入
          </button>
          <button
            type="button"
            onClick={() => switchMode("register")}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              mode === "register"
                ? "bg-amber-500 text-black"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            註冊
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "register" && (
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">姓名</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="name"
                placeholder="請輸入姓名"
                className="w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-white/10 text-slate-100 text-sm focus:outline-none focus:border-amber-500/50"
              />
            </div>
          )}

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="example@mail.com"
              className="w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-white/10 text-slate-100 text-sm focus:outline-none focus:border-amber-500/50"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">密碼</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="至少 6 個字元"
              className="w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-white/10 text-slate-100 text-sm focus:outline-none focus:border-amber-500/50"
            />
          </div>

          {mode === "register" && (
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">確認密碼</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                placeholder="再次輸入密碼"
                className="w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-white/10 text-slate-100 text-sm focus:outline-none focus:border-amber-500/50"
              />
            </div>
          )}

          {error && (
            <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 rounded-xl bg-amber-500 text-black font-bold text-sm hover:bg-amber-400 transition-all disabled:opacity-50"
          >
            {busy ? "處理中..." : mode === "login" ? "登入" : "建立帳號"}
          </button>
        </form>

        <p className="text-[11px] text-slate-600 text-center mt-6 leading-relaxed">
          帳號與醫療卡儲存於雲端 (Firebase)，可跨裝置同步，
          <br />
          登入後即使在無網路的災害現場也能讀取醫療卡。
        </p>
      </div>
    </div>
  );
}
