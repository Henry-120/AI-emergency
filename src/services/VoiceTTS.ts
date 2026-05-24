const API = import.meta.env.VITE_OPENAI_API_KEY || "";

export const playAudio = async (text: string) => {
  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API}`,
      },
      body: JSON.stringify({
        model: "tts-1",
        input: text,
        voice: "shimmer",
      }),
    });

    console.log("TTS API response status:", response.status);
    if (!response.ok) throw new Error("TTS API 請求失敗");

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    await audio.play();
  } catch (error) {
    console.error("Error generating speech:", error);
    throw error;
  }
};
