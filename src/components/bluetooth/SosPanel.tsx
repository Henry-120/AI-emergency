/**
 * GuardiaAI SOS 多跳中繼 - 求救頁面
 *
 * 從「附近的人」進入。跟一般聊天不同：對象不是特定某個人，而是「把求救丟進
 * 藍牙網路，讓沿路任何一個有網路的人幫忙轉出去」。中繼者解不開內容，只知道
 * 「有人需要幫忙」與粗略的嚴重程度。
 *
 * 文案原則同「附近的人」：不出現封包 / 加密 / 中繼等技術詞彙。
 */

import React, { useEffect, useState } from "react";
import { Severity } from "../../services/sos/sosTypes";
import { isSosEnabled, submitSos, subscribeSosStatus, getSosRecords } from "../../services/sos/sosRelay";
import { hasMedicalCard } from "../../services/medicalCardService";

interface Props {
  onBack: () => void;
  myLocation: { lat: number; lng: number } | null;
}

const SEVERITY_OPTIONS: Array<{ flag: number; label: string }> = [
  { flag: Severity.TRAPPED, label: "受困，出不去" },
  { flag: Severity.INJURED, label: "受傷" },
  { flag: Severity.NEEDS_MEDICAL, label: "需要醫療協助" },
];

const STATUS_LABEL: Record<string, string> = {
  sending: "正在送出…",
  queued_offline: "已存好，等待附近有人幫忙轉出去…",
  uploaded: "已送到後端，等待確認…",
  delivered: "已確認送達，救援單位已收到",
  failed: "送出失敗，已自動排隊等待重試",
};

export function SosPanel({ onBack, myLocation }: Props) {
  const [text, setText] = useState("");
  const [severity, setSeverity] = useState(0);
  const [includeMedical, setIncludeMedical] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [activeMsgId, setActiveMsgId] = useState<string | null>(null);
  const [, forceUpdate] = useState(0);

  useEffect(() => subscribeSosStatus(() => forceUpdate((n) => n + 1)), []);

  const toggleSeverity = (flag: number) => {
    setSeverity((prev) => (prev & flag ? prev & ~flag : prev | flag));
  };

  const handleSend = async () => {
    if (!text.trim()) {
      setErrorMsg("請簡短描述你的狀況");
      return;
    }
    if (!isSosEnabled()) {
      setErrorMsg("求救功能尚未啟用（後端尚未設定），請改用「附近的人」聯繫他人協助");
      return;
    }

    setSending(true);
    setErrorMsg("");
    try {
      const msgId = await submitSos({
        text: text.trim(),
        location: myLocation ?? undefined,
        includeMedical,
        severity,
      });
      setActiveMsgId(msgId);
    } catch (err) {
      setErrorMsg("送出失敗：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSending(false);
    }
  };

  const activeRecord = activeMsgId
    ? getSosRecords().find((r) => r.msgId === activeMsgId)
    : undefined;

  return (
    <div className="h-screen flex flex-col bg-[#020617] overflow-hidden">
      <header className="glass-panel px-4 py-3 flex items-center gap-3 border-b border-white/5">
        <button onClick={onBack} className="text-slate-400 hover:text-white text-sm">
          ← 返回
        </button>
        <div className="text-white font-bold">求救</div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <p className="text-[12px] text-slate-400 leading-relaxed">
          求救內容會加密，只有救援後端解得開；幫你轉發的陌生人只會知道「附近有人需要幫忙」，
          看不到你的位置與病史。
        </p>

        <div>
          <div className="text-[12px] text-slate-400 mb-2">你的狀況（可複選）</div>
          <div className="flex flex-col gap-2">
            {SEVERITY_OPTIONS.map((opt) => (
              <label
                key={opt.flag}
                className="flex items-center gap-2 bg-slate-900/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200"
              >
                <input
                  type="checkbox"
                  checked={(severity & opt.flag) !== 0}
                  onChange={() => toggleSeverity(opt.flag)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[12px] text-slate-400 mb-2">描述一下狀況（可用語音輸入）</div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="例如：在三樓，樓梯被雜物擋住，需要協助"
            className="w-full h-24 bg-slate-900/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-white resize-none"
          />
        </div>

        <label className="flex items-center gap-2 bg-slate-900/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={includeMedical}
            onChange={(e) => setIncludeMedical(e.target.checked)}
          />
          附上醫療卡摘要（血型、藥物過敏、慢性病）
          {!hasMedicalCard() && (
            <span className="text-[11px] text-slate-500">（尚未填寫醫療卡）</span>
          )}
        </label>

        {!myLocation && (
          <div className="text-[12px] text-amber-300">
            目前抓不到定位，求救仍會送出，但不會附帶你的位置。
          </div>
        )}

        {errorMsg && (
          <div className="px-3 py-2 bg-rose-900/30 text-rose-200 text-[12px] rounded-xl border border-rose-500/20">
            {errorMsg}
          </div>
        )}

        {activeRecord && (
          <div className="px-3 py-2 bg-amber-900/20 text-amber-200 text-[12px] rounded-xl border border-amber-500/20">
            {STATUS_LABEL[activeRecord.status] ?? activeRecord.status}
            {activeRecord.error && `（${activeRecord.error}）`}
          </div>
        )}

        <button
          onClick={handleSend}
          disabled={sending}
          className="w-full px-4 py-3 rounded-xl text-sm font-semibold bg-rose-500/20 text-rose-200 border border-rose-500/30 disabled:opacity-50"
        >
          {sending ? "送出中…" : "送出求救"}
        </button>
      </div>
    </div>
  );
}
