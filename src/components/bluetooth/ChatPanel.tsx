/**
 * GuardiaAI 藍牙模組 - 對話面板
 *
 * 與某個附近的人直接傳訊息（不經過網路）。
 *
 * 訊息來源是常駐收件匣（bluetoothInbox）——不論使用者離開過幾次頁面，
 * 對話都完整保留。
 *
 * 文案原則：不出現藍牙術語。長度限制以「字數」表達，不是 bytes。
 *
 * 按鍵配置照使用當下決定：打字與送出在畫面最下緣的拇指區，送出鍵給主要色實心、
 * 56px 高（單手、手在抖也按得到）；返回是低頻動作，安靜地放左上但仍有 44px 觸控區。
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
  const canSend = Boolean(input.trim()) && !sending && !tooLong;

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
    <div className="command-surface flex h-screen flex-col bg-bg text-ink">
      <header className="safe-area-top shrink-0 border-b border-line bg-surface px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            aria-label="返回附近的人"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl text-muted transition-colors active:bg-surface-2 active:text-ink"
          >
            ←
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate font-data text-[1.0625rem] font-bold text-ink">
              {peer.localId ?? peer.name}
            </div>
            <div className="text-sm text-muted">直接連線，不需要網路</div>
          </div>
          {hasLocation && (
            <span className="shrink-0 rounded-lg bg-safe-soft px-2.5 py-1.5 text-[0.6875rem] font-bold text-safe-text">
              會附上你的位置
            </span>
          )}
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
        {records.length === 0 && (
          <div className="rounded-2xl border border-line bg-surface px-5 py-10 text-center">
            <div className="text-base font-bold text-ink">還沒有訊息</div>
            <p className="mx-auto mt-2 max-w-[34ch] text-sm leading-relaxed text-muted">
              傳送第一則訊息給對方。訊息會直接經藍牙送出，不需要網路。
            </p>
          </div>
        )}

        {records.map((record, idx) => {
          const isMe = record.direction === "out";
          const msg = record.message;
          // 存活訊號要醒目呈現成求救提示，不是普通聊天
          // （保留 main 舊 BLE「🆘 附近有人存活，需要救援」的語意）
          const isSurvival = msg.kind === "survival";

          const bubbleClass = isSurvival
            ? "bg-critical-soft text-ink border border-critical"
            : isMe
              ? "bg-primary text-primary-ink"
              : "bg-surface text-ink border border-line";

          // 自己的訊息在藍底上，時間與座標用同色降透明度；對方的用 muted token
          const metaClass = isMe && !isSurvival ? "text-primary-ink opacity-75" : "text-muted";

          return (
            <div
              key={`${msg.timestamp}-${idx}`}
              className={`flex ${isMe ? "justify-end" : "justify-start"}`}
            >
              <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${bubbleClass}`}>
                {isSurvival && (
                  <div className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-critical-text">
                    <span aria-hidden="true">🆘</span>
                    {isMe ? "已發出存活訊號" : "附近有人存活，需要救援"}
                  </div>
                )}
                <div className="whitespace-pre-wrap break-words text-base leading-relaxed">
                  {msg.text}
                </div>
                {msg.location && (
                  <div className={`mt-1.5 font-data text-[0.6875rem] ${metaClass}`}>
                    位置 {msg.location.lat.toFixed(4)}, {msg.location.lng.toFixed(4)}
                  </div>
                )}
                <div className={`mt-1 font-data text-[0.6875rem] ${metaClass}`}>
                  {new Date(msg.timestamp).toLocaleTimeString("zh-TW", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-3 border-t border-critical bg-critical-soft px-4 py-3"
        >
          <p className="flex-1 text-sm font-medium text-critical-text">{errorMsg}</p>
          <button
            onClick={() => setErrorMsg("")}
            aria-label="關閉這則訊息"
            className="-my-1 -mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg text-critical-text active:bg-critical-soft"
          >
            ✕
          </button>
        </div>
      )}

      {/* 打字與送出固定在畫面最下緣的拇指熱區——這是這個畫面唯一的目的 */}
      <form
        onSubmit={handleSubmit}
        className="safe-area-bottom shrink-0 border-t border-line bg-surface px-3 pt-3"
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="輸入訊息…"
            aria-label="訊息內容"
            disabled={sending}
            className={`min-h-[56px] flex-1 rounded-xl border bg-surface-2 px-3.5 text-base text-ink placeholder:text-muted focus:outline-none ${
              tooLong ? "border-critical" : "border-line focus:border-accent"
            }`}
          />
          <button
            type="submit"
            disabled={!canSend}
            className="min-h-[56px] shrink-0 rounded-xl bg-primary px-6 text-base font-bold text-primary-ink transition-colors active:opacity-80 disabled:bg-surface-2 disabled:text-muted"
          >
            {sending ? "傳送中…" : "傳送"}
          </button>
        </div>

        {/* 只在接近上限時才提示，平時不用打擾使用者 */}
        {input.length > MAX_TEXT_LENGTH - 40 && (
          <div
            aria-live="polite"
            className={`mt-1.5 text-right text-sm ${tooLong ? "font-bold text-critical-text" : "text-muted"}`}
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
