/**
 * GuardiaAI 藍牙模組 - 對話面板
 *
 * 與某個附近的人直接傳訊息（不經過網路）。
 *
 * 訊息來源是常駐收件匣（bluetoothInbox）——不論使用者離開過幾次頁面，
 * 對話都完整保留。
 *
 * 文案原則：不出現藍牙術語。長度限制以「字數」表達，不是 bytes。
 */

import React, { useEffect, useRef, useState } from "react";
import type {
  ChatRecord,
  NearbyDevice,
} from "../../services/bluetooth/bluetoothService";

/**
 * 訊息長度上限（字元數）。
 *
 * 長訊息現在會自動分片傳送，所以這不再是 BLE 單包的硬限制，而是一個合理的
 * 使用上限——災害情境下該講的是「我在三樓，腳被壓住」，不是長篇大論。
 */
const MAX_TEXT_LENGTH = 200;

interface Props {
  peer: NearbyDevice;
  records: ChatRecord[];
  hasLocation: boolean;
  onSend: (text: string) => Promise<{ success: boolean; error?: string }>;
  onBack: () => void;
}

export function ChatPanel({ peer, records, hasLocation, onSend, onBack }: Props) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // 訊息更新時自動捲到底
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [records]);

  const remaining = MAX_TEXT_LENGTH - input.length;
  const tooLong = remaining < 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending || tooLong) return;

    setSending(true);
    setErrorMsg("");
    const result = await onSend(text);
    setSending(false);

    if (result.success) {
      setInput("");
    } else {
      setErrorMsg(result.error ?? "訊息沒有送出去，請再試一次");
    }
  };

  return (
    <div className="h-screen flex flex-col bg-[#020617]">
      <header className="glass-panel px-4 py-3 flex items-center gap-3 border-b border-white/5">
        <button onClick={onBack} className="text-slate-400 hover:text-white text-sm">
          ← 返回
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-white font-semibold truncate">{peer.name}</div>
          <div className="text-[11px] text-slate-400">直接連線，不需要網路</div>
        </div>
        {hasLocation && (
          <span className="text-[10px] text-amber-300 bg-amber-500/15 px-2 py-1 rounded-full">
            會附上你的位置
          </span>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {records.length === 0 && (
          <div className="text-center text-slate-500 text-sm py-8">
            還沒有訊息。傳送第一則訊息給對方。
          </div>
        )}

        {records.map((record, idx) => {
          const isMe = record.direction === "out";
          const msg = record.message;

          return (
            <div
              key={`${msg.timestamp}-${idx}`}
              className={`flex ${isMe ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] rounded-2xl px-3 py-2 ${
                  isMe
                    ? "bg-amber-500/20 text-amber-50 border border-amber-500/30"
                    : "bg-slate-800 text-slate-100 border border-white/5"
                }`}
              >
                <div className="text-sm whitespace-pre-wrap break-words">
                  {msg.text}
                </div>
                {msg.location && (
                  <div className="text-[10px] mt-1 opacity-70">
                    位置：{msg.location.lat.toFixed(4)}, {msg.location.lng.toFixed(4)}
                  </div>
                )}
                <div className="text-[9px] mt-1 opacity-50">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {errorMsg && (
        <div className="px-4 py-2 bg-rose-900/30 text-rose-200 text-[12px] border-t border-rose-500/20">
          {errorMsg}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="px-3 py-3 border-t border-white/5 bg-slate-950/80"
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="輸入訊息…"
            disabled={sending}
            className={`flex-1 bg-slate-900 border rounded-xl px-3 py-3 text-sm text-white placeholder-slate-500 focus:outline-none ${
              tooLong
                ? "border-rose-500/60 focus:border-rose-500"
                : "border-white/10 focus:border-amber-500/50"
            }`}
          />
          <button
            type="submit"
            disabled={sending || !input.trim() || tooLong}
            className="px-5 py-3 bg-amber-500/30 text-amber-100 border border-amber-500/40 rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-amber-500/40"
          >
            {sending ? "傳送中…" : "傳送"}
          </button>
        </div>

        {/* 只在接近上限時才提示，平時不用打擾使用者 */}
        {input.length > MAX_TEXT_LENGTH - 40 && (
          <div
            className={`mt-1 text-[11px] text-right ${
              tooLong ? "text-rose-300" : "text-slate-500"
            }`}
          >
            {tooLong
              ? `訊息太長了，請刪掉 ${-remaining} 個字`
              : `還可以輸入 ${remaining} 個字`}
          </div>
        )}
      </form>
    </div>
  );
}
