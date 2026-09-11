import React, { useEffect, useRef, useState } from "react";
import { MapInfo } from "../../services/offlineMapsService";
import { createSpeechRecognizer } from "../../services/VoiceInput";

/**
 * 版面回到最初的結構（狀態列、離線地圖預覽、AR 鈕、快捷標籤、輸入列）。
 * 底色接續報頭的紫→深藍漸層，送出鈕帶漸層。
 */
export function AppFooter({
  autoListenSignal = 0,
  compact = false,
  downloadedMaps,
  input,
  isAnalyzing,
  offlineMapStatus,
  onOpenRoomRiskScanner,
  onDeleteMap,
  onSubmit,
  onViewMap,
  setInput,
}: {
  /** 數值每變動一次就自動開始聆聽。地震語音提示念完後由 App 觸發。 */
  autoListenSignal?: number;
  /** 使用者正在往上翻舊訊息時為 true：收起 AR 鈕與建議標籤，把畫面讓給訊息。 */
  compact?: boolean;
  downloadedMaps: MapInfo[];
  input: string;
  isAnalyzing: boolean;
  offlineMapStatus: string;
  onOpenRoomRiskScanner: () => void;
  onDeleteMap: (mapId: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onViewMap: (map: MapInfo) => void;
  setInput: (value: string) => void;
}) {
  const [inputFocused, setInputFocused] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [finalTranscript, setFinalTranscript] = useState("");
  const recognizerRef = useRef<ReturnType<
    typeof createSpeechRecognizer
  > | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    setSpeechSupported(Boolean(SpeechRecognition));

    return () => {
      recognizerRef.current?.stop();
    };
  }, []);

  const ensureRecognizer = (notifyUnsupported: boolean) => {
    if (recognizerRef.current) return recognizerRef.current;
    if (!speechSupported) {
      if (notifyUnsupported) {
        alert(
          "此瀏覽器不支援語音辨識。請使用支援的瀏覽器或 HTTPS/localhost 測試。",
        );
      }
      return null;
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
    return recognizerRef.current;
  };

  const startRecording = (notifyUnsupported: boolean) => {
    const recognizer = ensureRecognizer(notifyUnsupported);
    if (!recognizer) return;
    recognizer.start();
    setFinalTranscript("");
    setIsRecording(true);
  };

  const toggleRecording = () => {
    if (!isRecording) {
      startRecording(true);
    } else {
      recognizerRef.current?.stop();
      setIsRecording(false);
    }
  };

  // 聚焦輸入框時一律展開：使用者已經要打字了，這時候把工具列藏起來
  // 反而讓他找不到 AR 鈕。
  const hideQuickBar = compact && !inputFocused;

  // 地震語音提示念完後自動開麥克風。使用者正在避難，不該還要先找按鈕。
  // 初始值 0 代表「沒有要求」，所以跳過第一次執行。
  useEffect(() => {
    if (!autoListenSignal) return;
    startRecording(false);
  }, [autoListenSignal]);

  return (
    <footer className="footer-shell footer-safe shrink-0 px-3 pt-2 sm:p-4">
      <div className="max-w-3xl mx-auto min-w-0">
        {offlineMapStatus && (
          <div className="mb-2 max-h-16 overflow-y-auto px-3 py-2 rounded-xl bg-white/10 border border-white/15 text-[11px] sm:text-[12px] text-[#e9eaef]">
            {offlineMapStatus}
          </div>
        )}

        {downloadedMaps.length > 0 && (
          <div className="mb-2 max-h-36 overflow-y-auto overscroll-contain grid gap-2 sm:max-h-52 sm:gap-4">
            <div className="font-bold text-xs text-[#c3b8dc] uppercase tracking-wider">
              已下載離線地圖預覽 ({downloadedMaps.length})
            </div>
            <div className="grid gap-2 sm:gap-4 sm:grid-cols-2">
              {downloadedMaps.map((map) => (
                <div
                  key={map.map_id}
                  className="overflow-hidden rounded-3xl border border-white/15 bg-white/[0.07] transition-all hover:-translate-y-0.5"
                >
                  <div className="grad-05 relative h-20 sm:h-40 overflow-hidden flex flex-col items-center justify-center gap-1 sm:gap-2 p-3 sm:p-4">
                    <div className="text-[10px] uppercase tracking-[0.3em] text-white/60">
                      離線地圖預覽
                    </div>
                    <div className="text-sm font-semibold text-white text-center">
                      {map.map_id}
                    </div>
                    <div className="font-data text-[11px] text-white/70 text-center">
                      {map.tiles_count} 張瓦片 · 縮放 {map.zoom_levels.join(", ")}
                    </div>
                  </div>
                  <div className="hidden p-4 space-y-2 sm:block">
                    <div className="flex items-center justify-between text-[11px] text-[#a9aec0] uppercase tracking-widest">
                      <span>半徑</span>
                      <span className="font-data">{map.radius_km} km</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#a9aec0] uppercase tracking-widest">
                      <span>瓦片數</span>
                      <span className="font-data">{map.tiles_count}</span>
                    </div>
                    <div className="font-data text-[11px] text-[#c8ced6]">
                      中心：{map.center_latitude.toFixed(4)},{" "}
                      {map.center_longitude.toFixed(4)}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px] text-[#a9aec0]">
                      <span className="rounded-full bg-white/10 px-2 py-1 text-center">
                        {map.zoom_levels.join(" ")}
                      </span>
                      <span className="rounded-full bg-white/10 px-2 py-1 text-center">
                        {map.status}
                      </span>
                    </div>
                  </div>
                  <div className="p-3 pt-0 flex items-center gap-2">
                    <button
                      onClick={() => onDeleteMap(map.map_id)}
                      className="flex-1 rounded-xl border border-[rgba(178,54,75,0.45)] bg-[rgba(178,54,75,0.25)] py-2 text-[12px] font-semibold text-[#f2b4bd] transition-colors hover:bg-[rgba(178,54,75,0.4)]"
                    >
                      刪除地圖
                    </button>
                    <button
                      onClick={() => onViewMap(map)}
                      className="py-2 px-3 bg-white/10 text-[#e9eaef] border border-white/15 rounded-xl text-[12px] font-semibold hover:bg-white/20"
                    >
                      開啟地圖
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 往上翻舊訊息時收起這一列，把畫面讓給訊息；輸入框一聚焦就展開。
            用 grid-rows 0fr↔1fr 過場，不必寫死高度——這一列的高度會隨
            標籤是否換行而變，寫死的話收合到一半會跳。 */}
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
            hideQuickBar ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
          }`}
          aria-hidden={hideQuickBar}
          {...(hideQuickBar ? { inert: "" as unknown as boolean } : {})}
        >
          <div className="overflow-hidden">
        {/* AR 鈕放在捲動容器外面：overflow-x-auto 會把浮出的提示裁掉，
            而且這樣標籤左右捲動時，它也不會跟著滑走。 */}
        <div className="mb-2 flex items-center gap-2">
          {/* 它是「開一個新畫面」，和後面那些「把字填進輸入框」不同類，
              所以用實心底和圖示跟它們區隔開。 */}
          <button
            type="button"
            onClick={onOpenRoomRiskScanner}
            disabled={isAnalyzing}
            aria-label="開啟 AR 房間風險掃描"
            className="has-tip grad-action relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white shadow-[var(--elev-1)] transition-all active:scale-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {/* 四角取景框 + AR 字樣。Font Awesome 沒有帶字樣的圖示，
                所以自己畫；currentColor 讓它跟著按鈕文字色走。 */}
            <svg
              viewBox="0 0 24 24"
              className="h-[18px] w-[18px]"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M3 8.5V5.5A2.5 2.5 0 0 1 5.5 3H8.5M15.5 3H18.5A2.5 2.5 0 0 1 21 5.5V8.5M21 15.5V18.5A2.5 2.5 0 0 1 18.5 21H15.5M8.5 21H5.5A2.5 2.5 0 0 1 3 18.5V15.5"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
              />
              <text
                x="12"
                y="15.6"
                textAnchor="middle"
                fontSize="9.5"
                fontWeight="700"
                letterSpacing="-0.4"
                fill="currentColor"
              >
                AR
              </text>
            </svg>
            <span className="tip tip-up">AR 房間風險掃描</span>
          </button>

          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {["出口受阻", "呼吸困難", "已抵達頂樓"].map((tag) => (
              <button
                key={tag}
                onClick={() => setInput(tag)}
                className="shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full bg-white/10 border border-white/15 text-[10px] text-[#c8ced6] active:bg-white/25 transition-all"
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
          </div>
        </div>

        <form
          ref={formRef}
          onSubmit={(event) => {
            onSubmit(event);
            setFinalTranscript("");
          }}
          className="relative flex min-w-0 items-center gap-2"
        >
          <div className="relative flex-1">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="回報進度或回答問題..."
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              className="w-full min-w-0 bg-black/25 border border-white/15 rounded-2xl py-3 pl-4 pr-12 text-base sm:text-sm text-white caret-[#c3b8dc] focus:outline-none focus:border-[#c3b8dc] transition-all placeholder:text-[#8f95a8]"
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
                  ? "text-[#f2b4bd]"
                  : speechSupported
                    ? "text-[#8f95a8]"
                    : "text-white/20"
              } active:text-[#c3b8dc]`}
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
                <span className="h-2.5 w-2.5 rounded-full bg-[#f2b4bd]" />
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
              className="bg-safe text-white w-11 h-11 rounded-2xl flex items-center justify-center active:scale-90 transition-all"
              aria-label="確認送出語音辨識結果"
            >
              <i className="fas fa-check"></i>
            </button>
          ) : (
            <button
              type="submit"
              disabled={isAnalyzing || !input.trim()}
              className="grad-action text-white w-11 h-11 rounded-2xl flex items-center justify-center active:scale-90 transition-all disabled:opacity-30"
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
