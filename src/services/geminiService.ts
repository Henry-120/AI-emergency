import { ChatMessage, DisasterAnalysis } from "../types";
import { getBackendToken } from "./authService";
import { BACKEND } from "./backend";

const AI_TIMEOUT_MS = 40_000;

export class BackendAuthenticationError extends Error {
  constructor(message = "登入已過期，請重新登入") {
    super(message);
    this.name = "BackendAuthenticationError";
  }
}

async function readError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  if (typeof body?.detail === "string") return body.detail;
  if (response.status === 401) return "登入已過期，請重新登入";
  return `AI 服務暫時無法使用（HTTP ${response.status}）`;
}

/**
 * Send disaster analysis to FastAPI on Cloud Run. Gemini credentials remain in
 * Secret Manager and are never bundled into the web or iOS application.
 */
export async function analyzeDisaster(
  history: ChatMessage[],
  sensorContext: string,
  imageBase64?: string | null,
): Promise<DisasterAnalysis> {
  const token = getBackendToken();
  if (!token) throw new BackendAuthenticationError();

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const response = await fetch(`${BACKEND}/api/ai/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messages: history.slice(-30).map((message) => ({
          role: message.role,
          content: message.content,
        })),
        sensor_context: sensorContext,
        image_base64: imageBase64 || null,
      }),
      signal: controller.signal,
    });

    if (response.status === 401) {
      throw new BackendAuthenticationError(await readError(response));
    }
    if (!response.ok) throw new Error(await readError(response));
    return (await response.json()) as DisasterAnalysis;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("AI 回應逾時，請稍後重新送出");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
