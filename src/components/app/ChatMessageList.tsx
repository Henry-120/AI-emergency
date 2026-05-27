import React from "react";
// 為了安全起見，我們在這裡擴充 ChatMessage 的型態，允許選填的 imageBase64 欄位
import { ChatMessage as BaseChatMessage } from "../../types";

interface ChatMessage extends BaseChatMessage {
  imageBase64?: string | null; // 擴充讓型態支援圖片欄位
}

const getPriorityBorder = (priority: string) => {
  switch (priority) {
    case "CRITICAL":
      return "border-red-500/50 bg-red-500/5";
    case "HIGH":
      return "border-orange-500/40 bg-orange-500/5";
    default:
      return "border-amber-500/30 bg-amber-500/5";
  }
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
      className="flex-1 overflow-y-auto px-4 py-6 space-y-6"
      ref={scrollRef}
    >
      {messages.map((m) => (
        <div
          key={m.id}
          className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} animate-in fade-in slide-in-from-bottom-2 duration-300`}
        >
          <div
            className={`max-w-[90%] ${m.role === "user" ? "message-gradient-user text-black rounded-2xl rounded-tr-none px-4 py-3 shadow-xl" : ""}`}
          >
            {m.role === "assistant" && (
              <div className="space-y-4">
                <p className="text-sm font-medium leading-relaxed text-slate-200">
                  {m.content}
                </p>

                {m.analysis?.missingInfoRequests &&
                  m.analysis.missingInfoRequests.length > 0 && (
                    <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-4">
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-amber-500">
                          <i className="fas fa-question-circle text-xs"></i>
                          <span className="text-[10px] font-bold uppercase tracking-wider">
                            {isOffline ? "請選擇您的狀況" : "待確認資訊"}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {m.analysis.missingInfoRequests.map((req, i) => (
                            <div key={i} className="flex gap-2 items-start">
                              <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 flex-shrink-0"></div>
                              <p className="text-xs text-amber-100/70 leading-relaxed">
                                {req}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
                        {m.analysis.missingInfoRequests.map((option, i) => (
                          <button
                            key={`btn-${i}`}
                            onClick={() => onOfflineOption(option)}
                            className="px-3 py-2 bg-amber-500 hover:bg-amber-400 text-black text-[11px] font-black rounded-lg transition-all active:scale-95 shadow-lg shadow-amber-500/10"
                          >
                            {option}
                          </button>
                        ))}
                      </div>

                      {!isOffline && (
                        <button
                          onClick={() => alert("相機介面啟動...")}
                          className="w-full py-2 bg-amber-500/20 text-amber-500 border border-amber-500/30 text-[11px] font-bold rounded-lg flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
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
                        className={`p-4 rounded-xl border border-l-4 ${getPriorityBorder(step.priority)} animate-in zoom-in-95 duration-300`}
                        style={{ animationDelay: `${idx * 100}ms` }}
                      >
                        <div className="flex items-start gap-3">
                          <span className="text-xs font-black text-amber-500/50 mt-1">
                            {String(idx + 1).padStart(2, "0")}
                          </span>
                          <div>
                            <h4 className="font-bold text-sm mb-1">
                              {step.title}
                            </h4>
                            <p className="text-xs text-slate-400 leading-normal">
                              {step.description}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {m.role === "user" && (
              <div className="space-y-2">
                {/* 顯示文字訊息內容 */}
                <p className="text-sm font-bold tracking-tight">{m.content}</p>
                
                {/* 新增：如果使用者發送的這條訊息內含有圖片 Base64，就在對話框裡顯示出來 */}
                {m.imageBase64 && (
                  <div className="mt-1.5 overflow-hidden rounded-xl border border-black/10 max-w-[240px]">
                    <img 
                      src={`data:image/jpeg;base64,${m.imageBase64}`} 
                      alt="回報現場狀況照片" 
                      className="w-full h-auto object-cover max-h-48 block shadow-inner"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
      {isAnalyzing && (
        <div className="flex items-center gap-3 py-2">
          <div className="w-5 h-5 rounded-full border-2 border-amber-500/20 border-t-amber-500 animate-spin"></div>
          <span className="text-[11px] text-slate-500 font-bold uppercase tracking-widest">
            整合歷史資訊中...
          </span>
        </div>
      )}
    </main>
  );
}