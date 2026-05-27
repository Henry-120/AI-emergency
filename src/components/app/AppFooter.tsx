import React, { useEffect, useRef, useState } from "react";
import { MapInfo } from "../../services/offlineMapsService";
import { createSpeechRecognizer } from "../../services/VoiceInput";

export function AppFooter({
  downloadedMaps,
  input,
  isAnalyzing,
  offlineMapStatus,
  onDeleteMap,
  onSubmit,
  onViewMap,
  setInput,
}: {
  downloadedMaps: MapInfo[];
  input: string;
  isAnalyzing: boolean;
  offlineMapStatus: string;
  onDeleteMap: (mapId: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onViewMap: (map: MapInfo) => void;
  setInput: (value: string) => void;
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [finalTranscript, setFinalTranscript] = useState("");
  const recognizerRef = useRef<ReturnType<typeof createSpeechRecognizer> | null>(
    null,
  );
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSpeechSupported(Boolean(SpeechRecognition));

    return () => {
      recognizerRef.current?.stop();
    };
  }, []);

  const toggleRecording = () => {
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
            setIsRecording(false);
            setFinalTranscript(text);
          }
        },
        (error) => {
          console.error("Speech error:", error);
          setIsRecording(false);
          alert(`語音辨識錯誤：${error}`);
        },
      );
    }

    if (!isRecording) {
      recognizerRef.current.start();
      setFinalTranscript("");
      setIsRecording(true);
    } else {
      recognizerRef.current.stop();
      setIsRecording(false);
    }
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
              className="w-full bg-slate-800/40 border border-white/10 rounded-2xl py-3 pl-4 pr-20 text-sm focus:outline-none focus:border-amber-500/50 transition-all placeholder:text-slate-600 shadow-inner"
              disabled={isAnalyzing}
            />
            <button
              type="button"
              className="absolute right-12 top-1/2 -translate-y-1/2 text-slate-500 active:text-amber-500"
              onClick={() => alert("開啟相機相簿...")}
            >
              <i className="fas fa-images"></i>
            </button>
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
