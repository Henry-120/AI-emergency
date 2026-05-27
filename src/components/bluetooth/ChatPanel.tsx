/**
 * GuardiaAI 藍牙模組 - 點對點聊天面板
 *
 * 跟某個特定的同 App 用戶聊天。
 *
 * 父元件需傳入：
 *   - 對方資訊（NearbyDevice）
 *   - 屬於這個對話的訊息陣列（父元件統一管理所有對話訊息）
 *   - 送訊息的 callback（會呼叫 bluetoothService.sendMessage）
 *   - 自己的 GPS 位置（送訊息時附帶）
 *   - 返回列表的 callback
 */

import React, { useState, useEffect, useRef, useMemo } from "react";
import type {
  IncomingMessage,
  NearbyDevice,
  OutgoingMessage,
} from "../../services/bluetooth/bluetoothService";

/**
 * 與 bluetoothConstants.ts 的 MAX_MESSAGE_BYTES 對齊。
 * 這是序列化後整包 OutgoingMessage（含 from/timestamp/location JSON）的上限，
 * 而非純訊息文字上限；給使用者一個保守的軟提示即可。
 */
const SOFT_TEXT_BYTE_LIMIT = 140;

/** 訊息列表中的單筆訊息，含「方向」（我傳/別人傳）標記，方便靠左/靠右顯示 */
export interface ChatItem {
  direction: "in" | "out";
  message: OutgoingMessage | IncomingMessage;
}

interface Props {
  peer: NearbyDevice;
  messages: ChatItem[];
  myLocation: { lat: number; lng: number } | null;
  onSend: (text: string) => Promise<{ success: boolean; error?: string }>;
  onBack: () => void;
}

export function ChatPanel({ peer, messages, myLocation, onSend, onBack }: Props) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // 訊息更新時自動捲到底
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  /** UTF-8 後的位元組數（中文每字 3 bytes）。BLE GATT 對單包 size 有限制 */
  const byteLength = useMemo(
    () => new TextEncoder().encode(input).byteLength,
    [input],
  );
  const tooLong = byteLength > SOFT_TEXT_BYTE_LIMIT;

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
      setErrorMsg(result.error ?? "傳送失敗");
    }
  };

  return (
    <div className="h-screen flex flex-col bg-[#020617]">
      {/* 標頭 */}
      <header className="glass-panel px-4 py-3 flex items-center gap-3 border-b border-white/5">
        <button
          onClick={onBack}
          className="text-slate-400 hover:text-white text-sm"
        >
          ← 返回
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-white font-semibold truncate">{peer.name}</div>
          <div className="text-[11px] text-slate-400">
            BLE 直連 · {peer.rssi} dBm
          </div>
        </div>
        {myLocation && (
          <span className="text-[10px] text-amber-300 bg-amber-500/15 px-2 py-1 rounded-full">
            📍 含位置
          </span>
        )}
      </header>

      {/* 訊息列表 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-2"
      >
        {messages.length === 0 && (
          <div className="text-center text-slate-500 text-sm py-8">
            尚無訊息。傳送第一則訊息試試看。
          </div>
        )}

        {messages.map((item, idx) => {
          const isMe = item.direction === "out";
          return (
            <div
              key={idx}
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
                  {item.message.text}
                </div>
                {item.message.location && (
                  <div className="text-[10px] mt-1 opacity-70">
                    📍 {item.message.location.lat.toFixed(4)},{" "}
                    {item.message.location.lng.toFixed(4)}
                  </div>
                )}
                <div className="text-[9px] mt-1 opacity-50">
                  {new Date(item.message.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 錯誤提示 */}
      {errorMsg && (
        <div className="px-4 py-2 bg-rose-900/30 text-rose-200 text-[12px] border-t border-rose-500/20">
          {errorMsg}
        </div>
      )}

      {/* 輸入區 */}
      <form
        onSubmit={handleSubmit}
        className="px-3 py-3 border-t border-white/5 bg-slate-950/80"
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="輸入訊息..."
            disabled={sending}
            className={`flex-1 bg-slate-900 border rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none ${
              tooLong
                ? "border-rose-500/60 focus:border-rose-500"
                : "border-white/10 focus:border-amber-500/50"
            }`}
          />
          <button
            type="submit"
            disabled={sending || !input.trim() || tooLong}
            className="px-4 py-2 bg-amber-500/30 text-amber-100 border border-amber-500/40 rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-amber-500/40"
          >
            {sending ? "傳送中..." : "傳送"}
          </button>
        </div>
        {input.length > 0 && (
          <div
            className={`mt-1 text-[10px] text-right ${
              tooLong ? "text-rose-300" : "text-slate-500"
            }`}
          >
            {byteLength} / {SOFT_TEXT_BYTE_LIMIT} bytes
            {tooLong && " · 超出 BLE 單包上限，請縮短"}
          </div>
        )}
      </form>
    </div>
  );
}
