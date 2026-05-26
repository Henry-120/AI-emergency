// 簡單的 Web Speech API 包裝器，用於語音輸入（Speech-to-Text）
type ResultCallback = (text: string, isFinal: boolean) => void;
type ErrorCallback = (err: string) => void;

export function createSpeechRecognizer(
  onResult: ResultCallback,
  onError?: ErrorCallback,
  lang = "zh-TW",
) {
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) {
    return {
      supported: false,
      start: () => {},
      stop: () => {},
    };
  }

  const recog = new SpeechRecognition();
  recog.lang = lang;
  recog.interimResults = true;
  recog.continuous = false;

  recog.onresult = (ev: SpeechRecognitionEvent) => {
    const results = Array.from(ev.results as any);
    const finalText = results
      .filter((result) => result.isFinal)
      .map((result) => result[0].transcript)
      .join("")
      .trim();
    const interimText = results
      .filter((result) => !result.isFinal)
      .map((result) => result[0].transcript)
      .join("")
      .trim();

    if (finalText) {
      onResult(finalText, true);
    } else {
      onResult(interimText, false);
    }
  };

  recog.onerror = (ev: any) => {
    const rawError = ev.error || "speech error";
    const friendlyErrors: Record<string, string> = {
      "not-allowed": "語音權限未授權，請先允許麥克風存取並重新整理頁面。",
      "service-not-allowed": "語音服務被拒絕，請確認網路與瀏覽器權限設定。",
      "not-allowed-error": "語音辨識權限未授權，請先允許麥克風使用。",
      "no-speech": "未偵測到語音，請靠近麥克風再試一次。",
      "audio-capture": "無法取得麥克風資料，請確認裝置麥克風是否可用。",
    };

    const msg = friendlyErrors[rawError] || rawError;
    onError?.(msg);
  };

  recog.onend = () => {
    // 偵測結束時不做事，讓呼叫端控制 UI
  };

  return {
    supported: true,
    start: () => {
      try {
        recog.start();
      } catch (e) {
        onError?.((e as Error).message || "start error");
      }
    },
    stop: () => {
      try {
        recog.stop();
      } catch (e) {
        // ignore
      }
    },
  };
}
