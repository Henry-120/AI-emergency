import React, { useEffect, useRef, useState } from "react";
import { MapInfo } from "../../services/offlineMapsService";
import { createSpeechRecognizer } from "../../services/VoiceInput";

const QUICK_TAGS = ["已拍照回傳", "出口受阻", "呼吸困難", "已抵達頂樓"];

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
    <footer className="safe-area-bottom border-t border-line bg-surface px-4 pt-3 shadow-[0_-1px_2px_rgba(19,23,29,0.05)]">
      <div className="mx-auto max-w-xl">
        {offlineMapStatus && (
          <div className="mb-3 rounded-xl border border-line bg-surface-2 px-4 py-3 text-[13px] text-ink">
            {offlineMapStatus}
          </div>
        )}

        {downloadedMaps.length > 0 && (
          <div className="mb-3 space-y-3">
            <div className="text-[11px] font-bold tracking-wide text-muted">
              已下載離線地圖（{downloadedMaps.length}）
            </div>
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
              {downloadedMaps.map((map) => (
                <div
                  key={map.map_id}
                  className="overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--elev-1)]"
                >
                  <div className="flex h-28 flex-col items-center justify-center gap-1 bg-surface-2 p-4 text-center">
                    <i className="fas fa-map-location-dot text-xl text-accent" aria-hidden="true"></i>
                    <div className="text-sm font-semibold text-ink">{map.map_id}</div>
                    <div className="font-data text-[11px] text-muted">
                      {map.tiles_count} 瓦片 · 縮放 {map.zoom_levels.join(", ")}
                    </div>
                  </div>
                  <div className="space-y-1.5 p-3 text-[12px]">
                    <div className="flex items-center justify-between text-muted">
                      <span>半徑</span>
                      <span className="font-data text-ink">{map.radius_km} km</span>
                    </div>
                    <div className="flex items-center justify-between text-muted">
                      <span>中心座標</span>
                      <span className="font-data text-ink">
                        {map.center_latitude.toFixed(3)}, {map.center_longitude.toFixed(3)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-3 pt-0">
                    <button
                      onClick={() => onViewMap(map)}
                      className="flex-1 rounded-lg bg-primary py-2 text-[13px] font-semibold text-primary-ink transition-transform active:scale-95"
                    >
                      開啟地圖
                    </button>
                    <button
                      onClick={() => onDeleteMap(map.map_id)}
                      className="rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-semibold text-critical-text transition-colors hover:bg-critical-soft"
                      aria-label={`刪除地圖 ${map.map_id}`}
                    >
                      <i className="fas fa-trash-can" aria-hidden="true"></i>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto pb-1">
          {QUICK_TAGS.map((tag) => (
            <button
              key={tag}
              onClick={() => setInput(tag)}
              className="shrink-0 whitespace-nowrap rounded-full border border-line bg-surface-2 px-3.5 py-2 text-[13px] font-medium text-ink transition-colors active:bg-primary active:text-primary-ink"
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
              placeholder="回報進度或回答問題…"
              className="w-full rounded-2xl border border-line bg-surface-2 py-3.5 pl-4 pr-[5.5rem] text-[15px] text-ink transition-colors placeholder:text-muted focus:border-primary focus:outline-none"
              disabled={isAnalyzing}
            />
            <button
              type="button"
              className="absolute right-12 top-1/2 -translate-y-1/2 p-1 text-muted transition-colors hover:text-accent"
              onClick={() => alert("開啟相機相簿...")}
              aria-label="新增照片"
            >
              <i className="fas fa-image" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              aria-pressed={isRecording}
              aria-disabled={!speechSupported}
              onClick={toggleRecording}
              disabled={isAnalyzing || !speechSupported}
              className={`absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5 p-1 transition-colors ${
                isRecording
                  ? "text-critical-text"
                  : speechSupported
                    ? "text-muted hover:text-accent"
                    : "text-muted/40"
              }`}
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
                <span className="pulse-soft h-2.5 w-2.5 rounded-full bg-critical"></span>
              )}
              <i className="fas fa-microphone" aria-hidden="true"></i>
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
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-safe text-white transition-transform active:scale-90"
              aria-label="確認送出語音辨識結果"
            >
              <i className="fas fa-check text-lg" aria-hidden="true"></i>
            </button>
          ) : (
            <button
              type="submit"
              disabled={isAnalyzing || !input.trim()}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-ink transition-transform active:scale-90 disabled:opacity-40"
              aria-label="送出"
            >
              <i
                className={`fas ${isAnalyzing ? "fa-circle-notch fa-spin" : "fa-arrow-up"} text-lg`}
                aria-hidden="true"
              ></i>
            </button>
          )}
        </form>
      </div>
    </footer>
  );
}
