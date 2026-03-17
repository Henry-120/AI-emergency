import React, { useState, useEffect, useRef } from "react";
import { analyzeDisaster } from "./services/geminiService";
import { ChatMessage, DisasterAnalysis, UserStatus } from "./types";
import EmergencyStatus from "./components/EmergencyStatus";
import SurvivalGauge from "./components/SurvivalGauge";
import { playAudio } from "./services/VoiceTTS";
import { getOfflineAnalysis } from "./services/offlineService";

const App: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentAnalysis, setCurrentAnalysis] =
    useState<DisasterAnalysis | null>(null);

  // 新增：用戶狀態
  const [userStatus, setUserStatus] = useState<UserStatus>({
    isMoving: false,
    heartRate: 72,
    batteryLevel: 85,
    location: null,
    hasInjuries: false,
  });

  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const speak = (text: string) => {
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    // 1. 取得目前裝置支援的所有聲音
    const voices = window.speechSynthesis.getVoices();

    // 2. 優先尋找台灣中文 (zh-TW)，其次是 zh-HK 或 zh-CN
    const chineseVoice =
      voices.find((v) => v.lang.includes("zh-TW")) ||
      voices.find((v) => v.lang.includes("zh-HK")) ||
      voices.find((v) => v.lang.includes("zh-CN"));

    if (chineseVoice) {
      utterance.voice = chineseVoice; // 強制指定中文聲音物件
    }

    utterance.lang = "zh-tw";
    utterance.rate = 1.0;
    utterance.pitch = 1.1;

    window.speechSynthesis.speak(utterance);
  };

  // 用於自動滾動到底部
  const scrollRef = useRef<HTMLDivElement>(null);

  // 每當 messages 更新時，自動滾動到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    // 初始系統訊息
    setMessages([
      {
        id: "1",
        role: "assistant",
        content:
          "我是 GuardiaAI 生存助手。請描述您目前遇到的緊急狀況，或直接上傳現場照片。",
        timestamp: new Date(),
      },
    ]);

    // 嘗試獲取用戶定位
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserStatus((prev) => ({
            ...prev,
            location: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          }));
        },
        () => console.log("定位獲取失敗"),
      );
    }

    // 模擬心率和電量變化
    const interval = setInterval(() => {
      setUserStatus((prev) => ({
        ...prev,
        heartRate: 70 + Math.floor(Math.random() * 10),
        batteryLevel: Math.max(0, prev.batteryLevel - 0.01),
      }));
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  // 處理使用者提交的訊息
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isAnalyzing) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date(),
    };

    // 立即在 UI 顯示使用者訊息
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    const currentInput = input;
    setInput("");
    // --- 離線邏輯開始 ---
    if (isOffline) {
      const offlineAnalysis = getOfflineAnalysis(currentInput);
      
      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "⚠️ 偵測到目前無網路連線，已啟動內建緊急應變模組：",
        analysis: offlineAnalysis,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMsg]);
      setCurrentAnalysis(offlineAnalysis);
      speak(offlineAnalysis.immediateActions[0].description);
      return; // 離線模式處理完畢，直接結束
    }
    // --- 離線邏輯結束 ---
    setIsAnalyzing(true);

    try {
      const sensorContext = `BPM: ${userStatus.heartRate}, 電量: ${userStatus.batteryLevel.toFixed(0)}%, 定位: ${userStatus.location ? "正常" : "無訊號"}`;

      // 將整個對話歷史傳送給 AI
      const analysis = await analyzeDisaster(updatedMessages, sensorContext);

      // AI 回應中包含缺少資訊的請求時，優先提示使用者提供這些資訊`
      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: analysis.missingInfoRequests?.length
          ? `收到回報。為了提供更精確的逃生指令，我還需要一些細節：`
          : `分析更新：根據最新資訊，請優先執行以下行動：`,
        analysis,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setCurrentAnalysis(analysis);

      if (analysis.immediateActions && analysis.immediateActions.length > 0) {
        const text = `緊急指令${analysis.immediateActions[0].title}`;
        // 優先嘗試 OpenAI，失敗則用原生降級
        playAudio(text).catch(() => {
          console.log("切換至原生語音降級模式");
          speak(text);
        });
      } else if (analysis.missingInfoRequests?.length) {
        // 如果是請求資訊
        speak(`請提供更多資訊：${analysis.missingInfoRequests[0]}`);
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "分析引擎繁忙中，請嘗試簡短描述您觀察到的新狀況。",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsAnalyzing(false);
    }
  };
  // --- 在這裡加入 handleOfflineOption ---
  const handleOfflineOption = (option: string) => {
    setInput(option);
    // 這裡可以選擇是否要點擊後自動送出，如果要自動送出可以加一行：
    setTimeout(() => document.querySelector('form')?.requestSubmit(), 100);
  };

  // 根據優先級不同的邊框顏色
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

  // 渲染 UI
  return (
    <div className="h-screen flex flex-col bg-[#020617] overflow-hidden">
      <header className="z-50 shadow-lg">
        <div className="flex items-center justify-between px-4 py-3 bg-[#020617] border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center shadow-lg shadow-amber-500/20">
              <i className="fas fa-shield-alt text-black text-xs"></i>
            </div>
            <span className="font-bold text-lg tracking-tight">
              Guardia<span className="text-amber-500">AI</span>
              {isOffline && <span className="ml-2 text-[10px] bg-red-500/20 text-red-500 px-2 py-0.5 rounded-full">OFFLINE</span>}
            </span>
          </div>

          <div className="flex items-center gap-4">
            {currentAnalysis && (
              <div className="flex items-center gap-2 animate-in fade-in duration-500">
                <div className="text-right">
                  <p className="text-[8px] text-slate-500 uppercase tracking-widest font-bold">
                    生存率
                  </p>
                  <p className="text-[10px] font-mono font-bold text-amber-500">
                    {currentAnalysis.survivalProbability}%
                  </p>
                </div>
                <SurvivalGauge
                  probability={currentAnalysis.survivalProbability}
                />
              </div>
            )}
            <button className="w-8 h-8 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center active:bg-red-500/30 transition-colors">
              <i className="fas fa-phone-alt text-red-500 text-xs"></i>
            </button>
          </div>
        </div>
        <EmergencyStatus status={userStatus} />
      </header>

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

                  {m.analysis?.missingInfoRequests && m.analysis.missingInfoRequests.length > 0 && (
                    <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-4">
                      {/* --- 保留原本的部分：文字清單 --- */}
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

                      {/* --- 新增的部分：快速互動按鈕 --- */}
                      <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
                        {m.analysis.missingInfoRequests.map((option, i) => (
                          <button
                            key={`btn-${i}`}
                            onClick={() => handleOfflineOption(option)}
                            className="px-3 py-2 bg-amber-500 hover:bg-amber-400 text-black text-[11px] font-black rounded-lg transition-all active:scale-95 shadow-lg shadow-amber-500/10"
                          >
                            {option}
                          </button>
                        ))}
                      </div>

                      {/* 保留原本的相機按鈕 (非離線模式下很有用) */}
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
                <p className="text-sm font-bold tracking-tight">{m.content}</p>
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

      <footer className="glass-panel p-4 safe-area-bottom">
        <div className="max-w-xl mx-auto">
          <div className="flex gap-2 mb-3 overflow-x-auto pb-1 no-scrollbar">
            {["已拍照回傳", "出口受阻", "呼吸困難", "已抵達頂樓"].map((tag) => (
              <button
                key={tag}
                onClick={() => setInput(tag)}
                className="whitespace-nowrap px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[10px] text-slate-400 active:bg-amber-500 active:text-black transition-all"
              >
                {tag}
              </button>
            ))}
          </div>

          <form
            onSubmit={handleSubmit}
            className="relative flex items-center gap-2"
          >
            <div className="relative flex-1">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="回報進度或回答問題..."
                className="w-full bg-slate-800/40 border border-white/10 rounded-2xl py-3 pl-4 pr-12 text-sm focus:outline-none focus:border-amber-500/50 transition-all placeholder:text-slate-600 shadow-inner"
                disabled={isAnalyzing}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 active:text-amber-500"
                onClick={() => alert("開啟相機相簿...")}
              >
                <i className="fas fa-images"></i>
              </button>
            </div>
            <button
              type="submit"
              disabled={isAnalyzing || !input.trim()}
              className="bg-amber-500 text-black w-11 h-11 rounded-2xl flex items-center justify-center shadow-[0_4px_15px_rgba(251,191,36,0.3)] active:scale-90 transition-all disabled:opacity-30 disabled:shadow-none"
            >
              <i
                className={`fas ${isAnalyzing ? "fa-circle-notch fa-spin" : "fa-arrow-up"}`}
              ></i>
            </button>
          </form>
        </div>
      </footer>
    </div>
  );
};

export default App;
