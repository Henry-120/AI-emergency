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
    <div className="h-screen flex flex-col bg-bg">
      <header className="safe-area-top border-b border-line bg-surface px-4 py-3 flex items-center gap-3 border-b border-line">
        <button onClick={onBack} className="text-muted hover:text-ink text-sm">
          ← 返回
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-ink font-semibold truncate">{peer.name}</div>
          <div className="text-[11px] text-muted">直接連線，不需要網路</div>
        </div>
        {hasLocation && (
          <span className="text-[10px] text-accent bg-surface-2 px-2 py-1 rounded-full">
            會附上你的位置
          </span>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {records.length === 0 && (
          <div className="text-center text-muted text-sm py-8">
            還沒有訊息。傳送第一則訊息給對方。
          </div>
        )}

        {records.map((record, idx) => {
          const isMe = record.direction === "out";
          const msg = record.message;
          // 存活訊號要醒目呈現成求救提示，不是普通聊天
          // （保留 main 舊 BLE「🆘 附近有人存活，需要救援」的語意）
          const isSurvival = msg.kind === "survival";

          const bubbleClass = isSurvival
            ? "bg-critical-soft text-critical-text border border-critical"
            : isMe
              ? "bg-surface-2 text-accent border border-accent"
              : "bg-surface-2 text-ink border border-line";

          return (
            <div
              key={`${msg.timestamp}-${idx}`}
              className={`flex ${isMe ? "justify-end" : "justify-start"}`}
            >
              <div className={`max-w-[75%] rounded-2xl px-3 py-2 ${bubbleClass}`}>
                {isSurvival && (
                  <div className="text-[11px] font-bold text-critical-text mb-1">
                    🆘 {isMe ? "已發出存活訊號" : "附近有人存活，需要救援"}
                  </div>
                )}
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
        <div className="px-4 py-2 bg-critical-soft text-critical-text text-[12px] border-t border-critical">
          {errorMsg}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="px-3 py-3 border-t border-line bg-bg"
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="輸入訊息…"
            disabled={sending}
            className={`flex-1 bg-surface border rounded-xl px-3 py-3 text-sm text-ink text-muted focus:outline-none ${
              tooLong
                ? "border-critical focus:border-critical"
                : "border-line focus:border-accent"
            }`}
          />
          <button
            type="submit"
            disabled={sending || !input.trim() || tooLong}
            className="px-5 py-3 bg-surface-2 text-accent border border-accent rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-surface-2"
          >
            {sending ? "傳送中…" : "傳送"}
          </button>
        </div>

        {/* 只在接近上限時才提示，平時不用打擾使用者 */}
        {input.length > MAX_TEXT_LENGTH - 40 && (
          <div
            className={`mt-1 text-[11px] text-right ${
              tooLong ? "text-critical-text" : "text-muted"
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
