import React from "react";
import { ChatMessage } from "../../types";

/**
 * 版面回到最初的結構（對話泡泡 + 卡片清單），配色改用
 * #MindfulPalettes No.150，使用者泡泡與主要動作帶漸層。
 */
/**
 * 危急程度：底色 + 徽章（圖示＋文字）。原本只用底色，使用者看不出輕重——編號只代表順序，
 * 不代表緊急度。徽章讓紅綠色盲也讀得出來（DESIGN.md 的 Priority mapping）。
 * 刻意不畫框線：框線讓畫面顯得雜亂，緊急度交給徽章表達。
 */
const PRIORITY_STYLES: Record<string, { label: string; icon: string; card: string; badge: string }> = {
  CRITICAL: {
    label: "緊急",
    icon: "fa-triangle-exclamation",
    card: "bg-critical-soft",
    badge: "bg-critical text-white",
  },
  HIGH: {
    label: "重要",
    icon: "fa-circle-exclamation",
    card: "bg-high-soft",
    badge: "bg-high text-primary-ink",
  },
  MEDIUM: {
    label: "留意",
    icon: "fa-circle-info",
    card: "bg-surface",
    badge: "bg-accent text-primary-ink",
  },
};

const getPriorityStyle = (priority: string) => PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.MEDIUM;

const getRoomRiskFill = (risk: string) => {
  if (risk === "high") return "bg-critical-soft";
  if (risk === "medium") return "bg-high-soft";
  return "bg-safe-soft";
};

const getZoneBadge = (type: string) => {
  if (type === "danger") return "bg-critical text-white";
  if (type === "caution") return "bg-high text-white";
  return "bg-safe text-white";
};

export function ChatMessageList({
  isAnalyzing,
  isOffline,
  messages,
  onOfflineOption,
  onRequestPhoto,
  onViewingHistoryChange,
  scrollRef,
}: {
  isAnalyzing: boolean;
  isOffline: boolean;
  messages: ChatMessage[];
  onOfflineOption: (option: string) => void;
  /** 「提供視覺資料」：開相機（電腦上是選檔案），拍好的照片交給 App 送去 AI 分析。 */
  onRequestPhoto?: () => void;
  /** 往上翻舊訊息時為 true，回到最新時為 false。底部工具列據此收合。 */
  onViewingHistoryChange?: (viewingHistory: boolean) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  React.useEffect(() => {
    const element = scrollRef.current;
    if (!element || !onViewingHistoryChange) return;

    let lastTop = element.scrollTop;
    const onScroll = () => {
      const top = element.scrollTop;
      const delta = top - lastTop;
      // 小幅抖動不算方向：手指離開螢幕時的回彈會來回幾像素，
      // 不擋掉的話工具列會閃。
      if (Math.abs(delta) < 8) return;
      lastTop = top;

      // 已經在底部就一定展開——使用者要打字了，不該還得先滑一下。
      const atBottom =
        element.scrollHeight - top - element.clientHeight < 32;
      onViewingHistoryChange(atBottom ? false : delta < 0);
    };

    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [onViewingHistoryChange, scrollRef]);

  return (
    <main
      className="grad-canvas min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3 pb-[calc(var(--bottom-cluster-h,11rem)+0.75rem)] sm:px-4 sm:py-6 space-y-4 sm:space-y-6"
      ref={scrollRef}
    >
      {messages.map((m) => (
        <div
          key={m.id}
          className={`mx-auto flex w-full max-w-3xl msg-enter ${m.role === "user" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[94%] sm:max-w-[90%] min-w-0 break-words ${
              m.role === "user"
                ? "grad-action text-white rounded-2xl rounded-tr-none px-4 py-3 shadow-[var(--elev-2)]"
                : ""
            }`}
          >
            {m.role === "assistant" && (
              <div className="space-y-4">
                <p className="text-sm font-medium leading-relaxed text-ink whitespace-pre-wrap">
                  {m.content}
                </p>

                {m.analysis?.situationSummary && (
                  <div className="p-4 bg-surface rounded-xl shadow-[var(--elev-soft)]">
                    <div className="flex items-center gap-2 text-muted mb-2">
                      <i className="fas fa-circle-info text-xs"></i>
                      <span className="text-[10px] font-bold uppercase tracking-wider">
                        狀況分析
                      </span>
                    </div>
                    <p className="text-sm text-ink leading-relaxed">
                      {m.analysis.situationSummary}
                    </p>
                  </div>
                )}

                {m.analysis?.missingInfoRequests &&
                  m.analysis.missingInfoRequests.length > 0 && (
                    <div className="p-4 bg-surface rounded-xl shadow-[var(--elev-soft)] space-y-4">
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-accent">
                          <i className="fas fa-question-circle text-xs"></i>
                          <span className="text-[10px] font-bold uppercase tracking-wider">
                            {isOffline ? "請選擇您的狀況" : "待確認資訊"}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {m.analysis.missingInfoRequests.map((req, i) => (
                            <div key={i} className="flex gap-2 items-start">
                              <div className="w-1.5 h-1.5 rounded-full bg-accent mt-1.5 flex-shrink-0"></div>
                              <p className="text-xs text-muted leading-relaxed">
                                {req}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-3">
                        {m.analysis.missingInfoRequests.map((option, i) => (
                          <button
                            key={`btn-${i}`}
                            onClick={() => onOfflineOption(option)}
                            className="grad-action px-3 py-2 text-white text-[11px] font-black rounded-lg transition-all active:scale-95"
                          >
                            {option}
                          </button>
                        ))}
                      </div>

                      {!isOffline && (
                        <button
                          onClick={onRequestPhoto}
                          className="w-full py-2 bg-surface-2 text-accent text-[11px] font-bold rounded-lg flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
                        >
                          <i className="fas fa-camera"></i>
                          提供視覺資料
                        </button>
                      )}
                    </div>
                  )}

                {m.analysis && (
                  <div className="space-y-3">
                    {m.analysis.immediateActions.map((step, idx) => {
                      const priority = getPriorityStyle(step.priority);
                      return (
                        <div
                          key={idx}
                          className={`p-4 rounded-xl shadow-[var(--elev-soft)] ${priority.card}`}
                        >
                          <div className="flex items-start gap-3">
                            <span className="font-data text-xs font-black text-muted mt-1">
                              {String(idx + 1).padStart(2, "0")}
                            </span>
                            <div className="min-w-0">
                              <div className="mb-1 flex flex-wrap items-center gap-2">
                                <span
                                  className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${priority.badge}`}
                                >
                                  <i className={`fas ${priority.icon} text-[10px]`} aria-hidden="true"></i>
                                  {priority.label}
                                </span>
                                <h4 className="font-bold text-sm text-ink">
                                  {step.title}
                                </h4>
                              </div>
                              <p className="text-xs text-muted leading-normal">
                                {step.description}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {m.roomRiskAnalysis && (
                  <div className="space-y-3 rounded-xl bg-surface p-4 shadow-[var(--elev-soft)]">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-high-text">
                        <i className="fas fa-couch text-xs"></i>
                        <span className="text-[10px] font-bold uppercase tracking-wider">
                          家具擺放風險
                        </span>
                      </div>
                      <span className="font-data rounded-full bg-surface-2 px-2 py-1 text-[10px] text-muted">
                        {m.roomRiskAnalysis.overallRiskLevel}/5
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-muted">
                      {m.roomRiskAnalysis.summary}
                    </p>

                    {m.roomRiskAnalysis.objects.length > 0 && (
                      <div className="space-y-2">
                        {m.roomRiskAnalysis.objects.slice(0, 4).map((object, i) => (
                          <div
                            key={`${object.label}-${i}`}
                            className={`rounded-lg px-3 py-2 ${getRoomRiskFill(object.risk)}`}
                          >
                            <div className="mb-1 text-xs font-bold text-ink">
                              {object.label}
                            </div>
                            <p className="text-[11px] leading-relaxed text-muted">
                              {object.reason}
                            </p>
                            <p className="mt-1 text-[11px] font-medium leading-relaxed text-ink">
                              {object.recommendation}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}

                    {m.roomRiskAnalysis.zones.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {m.roomRiskAnalysis.zones.slice(0, 5).map((zone) => (
                          <span
                            key={zone.id}
                            className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${getZoneBadge(zone.type)}`}
                            title={zone.reason}
                          >
                            {zone.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {m.role === "user" && (
              <>
                {m.imageBase64 && (
                  <img
                    src={m.imageBase64}
                    alt="現場照片"
                    className="mb-2 max-h-56 w-auto rounded-lg"
                  />
                )}
                <p className="text-sm font-bold tracking-tight">{m.content}</p>
              </>
            )}
          </div>
        </div>
      ))}
      {isAnalyzing && (
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 py-2">
          <div className="w-5 h-5 rounded-full border-2 border-line border-t-accent animate-spin"></div>
          <span className="text-[11px] text-muted font-bold uppercase tracking-widest">
            整合歷史資訊中...
          </span>
        </div>
      )}
    </main>
  );
}
