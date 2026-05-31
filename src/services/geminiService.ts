import { GoogleGenAI, Type } from "@google/genai";
import { DisasterAnalysis, ChatMessage } from "../types";

// const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
// 改用 Vite 標準讀取方式
// 延遲初始化：沒有 API 金鑰時不要在載入階段就拋錯（否則整個 App 會白畫面）。
let aiClient: GoogleGenAI | null = null;
function getAi(): GoogleGenAI {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || "";
  if (!apiKey) {
    throw new Error(
      "尚未設定 Gemini API 金鑰，請在專案根目錄建立 .env.local 並加入 VITE_GEMINI_API_KEY=你的金鑰",
    );
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

const ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    type: {
      type: Type.STRING,
      description: "災害類型（如地震、火災等）",
    },
    riskLevel: {
      type: Type.NUMBER,
      description: "1-10 的風險分數",
    },
    situationSummary: {
      type: Type.STRING,
      description: "當前狀況摘要",
    },
    immediateActions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          priority: { type: Type.STRING, enum: ["CRITICAL", "HIGH", "MEDIUM"] },
        },
        required: ["title", "description", "priority"],
      },
      description: "最高生存率行動建議",
    },
    longTermAdvice: {
      type: Type.STRING,
      description: "後續建議",
    },
    survivalProbability: {
      type: Type.NUMBER,
      description: "生存率百分比",
    },
    missingInfoRequests: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "尚未獲得但對評估至關重要的資訊請求",
    },
  },
  required: [
    "type",
    "riskLevel",
    "situationSummary",
    "immediateActions",
    "longTermAdvice",
    "survivalProbability",
  ],
};

export async function analyzeDisaster(
  history: ChatMessage[],
  sensorContext: string,
): Promise<DisasterAnalysis> {
  const systemInstruction = `
    你是一位具備記憶與邏輯推演能力的災害應變專家 AI。
    
    你的任務是分析「完整的對話紀錄」與「即時感測器數據」，提供能達到「最高生存率」的計畫。
    
    關鍵準則：
    1. **記憶連續性**：閱讀對話紀錄。如果使用者之前已經提供過某項資訊（例如樓層、傷情），請勿重複詢問。
    2. **資訊補完**：檢查對話中是否還有遺漏的關鍵細節。如果還有不清楚的地方（例如雖然知道在火場，但不知道有無出口被堵塞），請在 'missingInfoRequests' 中提出。
    3. **情境適應**：根據最新的感測器數據（${sensorContext}）判斷使用者生理與環境狀態。
    4. **結構化輸出**：始終返回 JSON 格式，包含即時行動步驟與生存率預估。
    5. **直接回答事實問題**：若使用者詢問地震規模、震央或時間等事實，請在 'situationSummary' 開頭就明確說出感測器背景資訊中的規模數字與位置，再接續應變建議。
  `;

  // 將 ChatMessage 轉換為 Gemini 的對話格式
  const contents = history.map((msg) => ({
    role: msg.role === "user" ? "user" : "model",
    parts: [{ text: msg.content }],
  }));

  // 在最後一則訊息加入感測器背景資訊
  if (contents.length > 0) {
    const lastMsg = contents[contents.length - 1];
    lastMsg.parts[0].text += `\n\n[系統感測器背景資訊: ${sensorContext}]`;
  }

  try {
    const response = await getAi().models.generateContent({
      model: "gemini-3-flash-preview",
      contents: contents,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: ANALYSIS_SCHEMA,
      },
    });

    const result = JSON.parse(response.text || "{}");
    return result as DisasterAnalysis;
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    throw error;
  }
}
