import { buildBackendUrl } from "./backend";

/**
 * 雲端語音（Google Cloud TTS），由後端代打。
 *
 * 舊版直接在瀏覽器帶著 VITE_OPENAI_API_KEY 打 api.openai.com——那個金鑰會被
 * 打包進前端 JS，任何人開 F12 就能拿走。現在改由後端持有憑證，前端只收音訊。
 */

let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

/** 停止目前播放中的雲端語音，並釋放 blob。 */
export const stopCloudSpeech = () => {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.onended = null;
    currentAudio.onerror = null;
    currentAudio = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
};

/**
 * 用雲端語音朗讀。
 *
 * @param speakingRate 語速倍率，Google 接受 0.25～4.0，1.0 為原速。
 * @returns 播放完成時 resolve。若後端無法合成、或瀏覽器擋下自動播放，
 *          則丟出錯誤，由呼叫端退回瀏覽器內建語音。
 */
export const playCloudSpeech = async (
  text: string,
  speakingRate = 1.0,
): Promise<void> => {
  const response = await fetch(buildBackendUrl("/api/tts"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, speakingRate }),
  });

  if (!response.ok) {
    let detail = `TTS ${response.status}`;
    try {
      detail = (await response.json())?.detail || detail;
    } catch {
      // 回應不是 JSON 就沿用狀態碼。
    }
    throw new Error(detail);
  }

  const blob = await response.blob();
  if (!blob.size) throw new Error("TTS 回傳空音訊");

  stopCloudSpeech();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  currentAudio = audio;
  currentUrl = url;

  // play() 在瀏覽器擋下自動播放時會 reject，這時要讓呼叫端知道並改用備援。
  await audio.play();

  await new Promise<void>((resolve) => {
    audio.onended = () => resolve();
    // 播到一半失敗也要往下走，否則後續流程（例如自動開麥克風）會卡死。
    audio.onerror = () => resolve();
  });

  if (currentAudio === audio) {
    stopCloudSpeech();
  }
};

/** @deprecated 舊名稱，保留給既有呼叫端。 */
export const playAudio = playCloudSpeech;
