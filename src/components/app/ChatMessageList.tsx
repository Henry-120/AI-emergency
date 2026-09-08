import React from "react";
import { ChatMessage } from "../../types";

/**
 * 版面回到最初的結構（對話泡泡 + 卡片清單），配色改用
 * #MindfulPalettes No.150，使用者泡泡與主要動作帶漸層。
 */
const getPriorityBorder = (priority: string) => {
  switch (priority) {
    case "CRITICAL":
      return "border-critical bg-critical-soft";
    case "HIGH":
      return "border-high bg-high-soft";
    default:
      return "border-line bg-surface";
  }
};

const getRoomRiskBorder = (risk: string) => {
  if (risk === "high") return "border-critical bg-critical-soft";
  if (risk === "medium") return "border-high bg-high-soft";
  return "border-safe bg-safe-soft";
};

const getZoneBadge = (type: string) => {
  if (type === "danger") return "bg-critical text-white border-critical";
  if (type === "caution") return "bg-high text-white border-high";
  return "bg-safe text-white border-safe";
};

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
    <main
      className="grad-canvas min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4 sm:py-6 space-y-4 sm:space-y-6"
      ref={scrollRef}
    >
      {messages.map((m) => (
        <div
          key={m.id}
          className={`flex msg-enter ${m.role === "user" ? "justify-end" : "justify-start"}`}
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
                  <div className="p-4 bg-surface border border-line rounded-xl">
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
                    <div className="p-4 bg-surface border border-line rounded-xl space-y-4">
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

                      <div className="flex flex-wrap gap-2 pt-2 border-t border-line">
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
                          onClick={() => alert("相機介面啟動...")}
                          className="w-full py-2 bg-surface-2 text-accent border border-line text-[11px] font-bold rounded-lg flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
                        >
                          <i className="fas fa-camera"></i>
                          提供視覺資料
                        </button>
                      )}
                    </div>
                  )}

                {m.analysis && (
                  <div className="space-y-3">
                    {m.analysis.immediateActions.map((step, idx) => (
                      <div
                        key={idx}
                        className={`p-4 rounded-xl border border-l-4 ${getPriorityBorder(step.priority)}`}
                      >
                        <div className="flex items-start gap-3">
                          <span className="font-data text-xs font-black text-muted mt-1">
                            {String(idx + 1).padStart(2, "0")}
                          </span>
                          <div>
                            <h4 className="font-bold text-sm mb-1 text-ink">
                              {step.title}
                            </h4>
                            <p className="text-xs text-muted leading-normal">
                              {step.description}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {m.roomRiskAnalysis && (
                  <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
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
                            className={`rounded-lg border px-3 py-2 ${getRoomRiskBorder(object.risk)}`}
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
                            className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${getZoneBadge(zone.type)}`}
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
              <p className="text-sm font-bold tracking-tight">{m.content}</p>
            )}
          </div>
        </div>
      ))}
      {isAnalyzing && (
        <div className="flex items-center gap-3 py-2">
          <div className="w-5 h-5 rounded-full border-2 border-line border-t-accent animate-spin"></div>
          <span className="text-[11px] text-muted font-bold uppercase tracking-widest">
            整合歷史資訊中...
          </span>
        </div>
      )}
    </main>
  );
}
