import React, { useEffect, useRef, useState } from "react";
import { MapInfo } from "../../services/offlineMapsService";
import { createSpeechRecognizer } from "../../services/VoiceInput";

export function AppFooter({
  downloadedMaps,
  input,
  isAnalyzing,
  offlineMapStatus,
  onOpenRoomRiskScanner,
  onDeleteMap,
  onSubmit,
  onViewMap,
  setInput,
  autoStartVoiceInput = false,
  onAutoStartHandled,
}: {
  downloadedMaps: MapInfo[];
  input: string;
  isAnalyzing: boolean;
  offlineMapStatus: string;
  onOpenRoomRiskScanner: () => void;
  onDeleteMap: (mapId: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onViewMap: (map: MapInfo) => void;
  setInput: (value: string) => void;
  autoStartVoiceInput?: boolean;
  onAutoStartHandled?: () => void;
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [finalTranscript, setFinalTranscript] = useState("");
  const recognizerRef = useRef<ReturnType<
    typeof createSpeechRecognizer
  > | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const finalTranscriptRef = useRef("");

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    setSpeechSupported(Boolean(SpeechRecognition));

    return () => {
      if (silenceTimerRef.current) {
        window.clearTimeout(silenceTimerRef.current);
      }
      recognizerRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!autoStartVoiceInput || !speechSupported) {
      return;
    }

    if (!recognizerRef.current) {
      recognizerRef.current = createSpeechRecognizer(
        (text, isFinal) => {
          setInput(text);
          if (isFinal) {
            finalTranscriptRef.current = text;
            setFinalTranscript(text);
          }
          if (silenceTimerRef.current) {
            window.clearTimeout(silenceTimerRef.current);
          }
          silenceTimerRef.current = window.setTimeout(() => {
            if (recognizerRef.current) {
              recognizerRef.current.stop();
              setIsRecording(false);
              const transcript = finalTranscriptRef.current.trim();
              if (transcript) {
                setInput(transcript);
                setFinalTranscript(transcript);
                formRef.current?.requestSubmit();
              }
            }
          }, 2000);
        },
        (error) => {
          console.error("Speech error:", error);
          setIsRecording(false);
          alert(`語音辨識錯誤：${error}`);
        },
      );
    }

    recognizerRef.current.start();
    setFinalTranscript("");
    finalTranscriptRef.current = "";
    setIsRecording(true);
    onAutoStartHandled?.();
  }, [autoStartVoiceInput, onAutoStartHandled, speechSupported]);

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const doHapticFeedback = async () => {
    try {
      // Prefer navigator.vibrate for web/mobile web
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        (navigator as any).vibrate?.(50);
        return;
      }

      // Fallback: try dynamic import of Capacitor Haptics for native builds
      const win: any = window as any;
      if (win?.Capacitor && win?.Capacitor.isNativePlatform && win?.Capacitor.isNativePlatform()) {
        try {
          // avoid static analysis by splitting module specifier
          const moduleName = "@" + "capacitor/haptics";
          const mod: any = await import(moduleName);
          const Haptics = mod?.Haptics || mod?.default || mod;
          if (Haptics && typeof Haptics.impact === "function") {
            Haptics.impact({ style: "MEDIUM" });
            return;
          }
        } catch (e) {
          // ignore dynamic import failures
        }
      }
    } catch (e) {
      // ignore failures
    }
  };

  const stopRecording = () => {
    clearSilenceTimer();
    recognizerRef.current?.stop();
    setIsRecording(false);
  };

  const startRecording = () => {
    if (!recognizerRef.current) {
      if (!speechSupported) {
        alert(
          "此瀏覽器不支援語音辨識。請使用支援的瀏覽器或 HTTPS/localhost 測試。",
        );
        return;
      }

      recognizerRef.current = createSpeechRecognizer(
        (text, isFinal) => {
          setInput(text);
          if (isFinal) {
            finalTranscriptRef.current = text;
            setFinalTranscript(text);
          }
          clearSilenceTimer();
          silenceTimerRef.current = window.setTimeout(() => {
            if (recognizerRef.current) {
              recognizerRef.current.stop();
              setIsRecording(false);
              const transcript = finalTranscriptRef.current.trim();
              if (transcript) {
                setInput(transcript);
                setFinalTranscript(transcript);
                formRef.current?.requestSubmit();
              }
            }
          }, 2000);
        },
        (error) => {
          console.error("Speech error:", error);
          setIsRecording(false);
          alert(`語音辨識錯誤：${error}`);
        },
      );
    }

    recognizerRef.current.start();
    setFinalTranscript("");
    finalTranscriptRef.current = "";
    setIsRecording(true);
    doHapticFeedback();
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
      doHapticFeedback();
      return;
    }

    startRecording();
  };

  return (
    <footer className="glass-panel p-4 safe-area-bottom">
      <div className="max-w-xl mx-auto">
        {offlineMapStatus && (
          <div className="mb-3 px-4 py-3 rounded-2xl bg-slate-900/80 border border-amber-500/15 text-[12px] text-amber-100">
            {offlineMapStatus}
          </div>
        )}
        {downloadedMaps.length > 0 && (
          <div className="mb-3 grid gap-4">
            <div className="font-bold text-xs text-amber-300 uppercase tracking-wider">
              已下載離線地圖預覽 ({downloadedMaps.length})
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {downloadedMaps.map((map) => (
                <div
                  key={map.map_id}
                  className="overflow-hidden rounded-3xl border border-white/10 bg-slate-900/80 shadow-lg shadow-black/30 transition-all hover:-translate-y-0.5 hover:shadow-2xl"
                >
                  <div className="relative h-40 overflow-hidden bg-slate-800 text-slate-200 flex flex-col items-center justify-center gap-2 p-4">
                    <div className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                      離線地圖預覽
                    </div>
                    <div className="text-sm font-semibold text-white text-center">
                      {map.map_id}
                    </div>
                    <div className="text-[11px] text-slate-400 text-center">
                      {map.tiles_count} 張瓦片 · 縮放{" "}
                      {map.zoom_levels.join(", ")}
                    </div>
                  </div>
                  <div className="p-4 space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-400 uppercase tracking-widest">
                      <span>半徑</span>
                      <span>{map.radius_km} km</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400 uppercase tracking-widest">
                      <span>瓦片數</span>
                      <span>{map.tiles_count}</span>
                    </div>
                    <div className="text-[11px] text-slate-300">
                      中心：{map.center_latitude.toFixed(4)},{" "}
                      {map.center_longitude.toFixed(4)}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400">
                      <span className="rounded-full bg-white/5 px-2 py-1">
                        {map.zoom_levels.join(" ")}
                      </span>
                      <span className="rounded-full bg-white/5 px-2 py-1">
                        {map.status}
                      </span>
                    </div>
                  </div>
                  <div className="p-3 pt-0 flex items-center gap-2">
                    <button
                      onClick={() => onDeleteMap(map.map_id)}
                      className="flex-1 py-2 bg-rose-600/10 text-rose-300 border border-rose-500/10 rounded-xl text-[12px] font-semibold hover:bg-rose-600/20"
                    >
                      刪除地圖
                    </button>
                    <button
                      onClick={() => onViewMap(map)}
                      className="py-2 px-3 bg-white/5 text-slate-300 border border-white/10 rounded-xl text-[12px] font-semibold hover:bg-white/10"
                    >
                      開啟地圖
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onOpenRoomRiskScanner}
          disabled={isAnalyzing}
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-bold text-amber-300 transition-all hover:bg-amber-500/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="開啟 AR 房間風險掃描"
        >
          <i className="fas fa-camera"></i>
          AR 房間風險掃描
        </button>

        <div className="flex gap-2 mb-3 overflow-x-auto pb-1 no-scrollbar">
          {["出口受阻", "呼吸困難", "已抵達頂樓"].map((tag) => (
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
          ref={formRef}
          onSubmit={(event) => {
            onSubmit(event);
            setFinalTranscript("");
          }}
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
              aria-pressed={isRecording}
              aria-disabled={!speechSupported}
              onClick={toggleRecording}
              disabled={isAnalyzing || !speechSupported}
              className={`absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2 ${
                isRecording
                  ? "text-rose-400"
                  : speechSupported
                    ? "text-slate-500"
                    : "text-slate-600/40"
              } active:text-amber-500`}
              aria-label={isRecording ? "停止語音輸入" : "開始語音輸入"}
              title={
                !speechSupported
                  ? "此瀏覽器不支援語音辨識"
                  : isRecording
                    ? "停止錄音"
                    : "開始語音輸入"
              }
            >
              {isRecording && (
                <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
              )}
              <i className="fas fa-microphone"></i>
              {/* Waveform SVG */}
              {isRecording && (
                <svg className="ml-2" width="34" height="14" viewBox="0 0 34 14" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                  <rect x="2" y="4" width="3" height="6" rx="1" fill="#ff6b6b">
                    <animate attributeName="height" values="6;12;6" dur="0.9s" repeatCount="indefinite" />
                    <animate attributeName="y" values="4;1;4" dur="0.9s" repeatCount="indefinite" />
                  </rect>
                  <rect x="8" y="3" width="3" height="8" rx="1" fill="#ff6b6b">
                    <animate attributeName="height" values="8;3;8" dur="1s" repeatCount="indefinite" />
                    <animate attributeName="y" values="3;6;3" dur="1s" repeatCount="indefinite" />
                  </rect>
                  <rect x="14" y="2" width="3" height="10" rx="1" fill="#ff6b6b">
                    <animate attributeName="height" values="10;4;10" dur="0.8s" repeatCount="indefinite" />
                    <animate attributeName="y" values="2;6;2" dur="0.8s" repeatCount="indefinite" />
                  </rect>
                  <rect x="20" y="3" width="3" height="8" rx="1" fill="#ff6b6b">
                    <animate attributeName="height" values="8;12;8" dur="1.1s" repeatCount="indefinite" />
                    <animate attributeName="y" values="3;1;3" dur="1.1s" repeatCount="indefinite" />
                  </rect>
                  <rect x="26" y="4" width="3" height="6" rx="1" fill="#ff6b6b">
                    <animate attributeName="height" values="6;9;6" dur="0.95s" repeatCount="indefinite" />
                    <animate attributeName="y" values="4;2;4" dur="0.95s" repeatCount="indefinite" />
                  </rect>
                </svg>
              )}
            </button>
            <div aria-live="polite" className="sr-only">
              {isRecording
                ? "錄音中"
                : finalTranscript
                  ? `辨識完成：${finalTranscript}`
                  : ""}
            </div>
          </div>
          {finalTranscript ? (
            <button
              type="button"
              onClick={() => {
                setInput(finalTranscript);
                formRef.current?.requestSubmit();
              }}
              className="bg-emerald-500 text-black w-11 h-11 rounded-2xl flex items-center justify-center shadow-[0_4px_15px_rgba(16,185,129,0.2)] active:scale-90 transition-all"
              aria-label="確認送出語音辨識結果"
            >
              <i className="fas fa-check"></i>
            </button>
          ) : (
            <button
              type="submit"
              disabled={isAnalyzing || !input.trim()}
              className="bg-amber-500 text-black w-11 h-11 rounded-2xl flex items-center justify-center shadow-[0_4px_15px_rgba(251,191,36,0.3)] active:scale-90 transition-all disabled:opacity-30 disabled:shadow-none"
            >
              <i
                className={`fas ${isAnalyzing ? "fa-circle-notch fa-spin" : "fa-arrow-up"}`}
              ></i>
            </button>
          )}
        </form>
      </div>
    </footer>
  );
}
