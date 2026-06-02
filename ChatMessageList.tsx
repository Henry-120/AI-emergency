import React from "react";
import { ChatMessage } from "../../types";

// Priority is conveyed by badge + icon + label + rank, never color alone.
const PRIORITY = {
  CRITICAL: {
    label: "最高優先",
    icon: "fa-triangle-exclamation",
    hero: "border-critical bg-critical-soft",
    solid: "bg-critical",
    card: "border-line bg-surface",
    badge: "bg-critical text-white",
    rank: "text-critical-text",
  },
  HIGH: {
    label: "高",
    icon: "fa-circle-exclamation",
    hero: "border-high bg-high-soft",
    solid: "bg-high",
    card: "border-line bg-surface",
    badge: "bg-high text-white",
    rank: "text-high-text",
  },
  MEDIUM: {
    label: "建議",
    icon: "fa-circle-info",
    hero: "border-line bg-surface",
    solid: "bg-primary",
    card: "border-line bg-surface",
    badge: "bg-surface-2 text-accent",
    rank: "text-accent",
  },
} as const;

const priorityOf = (p: string) =>
  PRIORITY[p as keyof typeof PRIORITY] ?? PRIORITY.MEDIUM;

export function ChatMessageList({
  isAnalyzing,
  isOffline,
  messages,
  onOfflineOption,
  scrollRef,
}: {
  isAnalyzing: boolean;
  isOffline: boolean;
  messages: ChatMessage[];
  onOfflineOption: (option: string) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <main className="flex-1 space-y-6 overflow-y-auto px-4 py-6" ref={scrollRef}>
      {messages.map((m) => (
        <div
          key={m.id}
          className={`msg-enter flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
        >
          {m.role === "user" ? (
            <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-primary-ink shadow-[var(--elev-1)]">
              <p className="text-[15px] font-medium leading-relaxed">{m.content}</p>
            </div>
          ) : (
            <div className="w-full max-w-[92%] space-y-4">
              <p className="text-base font-medium leading-relaxed text-ink">
                {m.content}
              </p>

              {m.analysis?.situationSummary && (
                <div className="rounded-xl border border-line bg-surface p-4">
                  <div className="mb-2 flex items-center gap-2 text-muted">
                    <i className="fas fa-circle-info text-xs text-accent" aria-hidden="true"></i>
                    <span className="text-[11px] font-bold tracking-wide">狀況分析</span>
                  </div>
                  <p className="text-[15px] leading-relaxed text-ink">
                    {m.analysis.situationSummary}
                  </p>
                </div>
              )}

              {m.analysis?.missingInfoRequests &&
                m.analysis.missingInfoRequests.length > 0 && (
                  <div className="space-y-4 rounded-xl border border-line bg-surface-2 p-4">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-accent">
                        <i className="fas fa-circle-question text-xs" aria-hidden="true"></i>
                        <span className="text-[11px] font-bold tracking-wide">
                          {isOffline ? "請選擇您的狀況" : "待確認資訊"}
                        </span>
                      </div>
                      <ul className="space-y-2">
                        {m.analysis.missingInfoRequests.map((req, i) => (
                          <li key={i} className="flex items-start gap-2.5">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted"></span>
                            <p className="text-sm leading-relaxed text-ink">{req}</p>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                      {m.analysis.missingInfoRequests.map((option, i) => (
                        <button
                          key={`btn-${i}`}
                          onClick={() => onOfflineOption(option)}
                          className="rounded-lg bg-primary px-3 py-2 text-[13px] font-semibold text-primary-ink transition-transform active:scale-95"
                        >
                          {option}
                        </button>
                      ))}
                    </div>

                    {!isOffline && (
                      <button
                        onClick={() => alert("相機介面啟動...")}
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary bg-surface py-2.5 text-[13px] font-semibold text-accent transition-colors hover:bg-surface-2"
                      >
                        <i className="fas fa-camera" aria-hidden="true"></i>
                        提供現場照片
                      </button>
                    )}
                  </div>
                )}

              {m.analysis && m.analysis.immediateActions.length > 0 && (
                <div className="space-y-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted">
                    立即行動
                  </p>

                  {/* Hero — the single most important next action, sized to dominate */}
                  {(() => {
                    const step = m.analysis.immediateActions[0];
                    const p = priorityOf(step.priority);
                    return (
                      <div className={`overflow-hidden rounded-2xl border-2 ${p.hero}`}>
                        <div className="flex items-stretch">
                          <div className={`flex w-14 shrink-0 items-center justify-center ${p.solid}`}>
                            <span className="font-data text-3xl font-black leading-none text-white">
                              01
                            </span>
                          </div>
                          <div className="min-w-0 flex-1 p-4">
                            <span className={`mb-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${p.badge}`}>
                              <i className={`fas ${p.icon} text-[9px]`} aria-hidden="true"></i>
                              {p.label}
                            </span>
                            <h3 className="text-2xl font-black leading-[1.15] text-ink [text-wrap:balance]">
                              {step.title}
                            </h3>
                            <p className="mt-2 text-[15px] leading-relaxed text-ink">
                              {step.description}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Remaining steps — stepped down, clearly secondary */}
                  {m.analysis.immediateActions.slice(1).map((step, i) => {
                    const idx = i + 1;
                    const p = priorityOf(step.priority);
                    return (
                      <div
                        key={idx}
                        className={`flex gap-3 rounded-xl border p-3.5 ${p.card}`}
                      >
                        <span className={`font-data text-lg font-bold leading-none ${p.rank}`}>
                          {String(idx + 1).padStart(2, "0")}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h4 className="text-[15px] font-bold leading-snug text-ink">
                              {step.title}
                            </h4>
                            <i className={`fas ${p.icon} text-[10px] ${p.rank}`} aria-hidden="true"></i>
                          </div>
                          <p className="mt-0.5 text-sm leading-relaxed text-muted">
                            {step.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {isAnalyzing && (
        <div className="flex justify-start" aria-live="polite">
          <div className="w-full max-w-[92%] space-y-3">
            <div className="flex items-center gap-2 text-muted">
              <i className="fas fa-circle-notch fa-spin text-xs text-accent" aria-hidden="true"></i>
              <span className="text-[13px] font-medium">正在整合現場資訊…</span>
            </div>
            <div className="space-y-2 rounded-xl border border-line bg-surface p-4">
              <div className="h-3 w-2/3 animate-pulse rounded bg-surface-2"></div>
              <div className="h-3 w-full animate-pulse rounded bg-surface-2"></div>
              <div className="h-3 w-4/5 animate-pulse rounded bg-surface-2"></div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
