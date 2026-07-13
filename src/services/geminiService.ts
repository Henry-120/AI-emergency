import { GoogleGenAI, Type } from "@google/genai";
import { DisasterAnalysis, ChatMessage } from "../types";

// const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
// 改用 Vite 標準讀取方式
const ai = new GoogleGenAI({
  apiKey: import.meta.env.VITE_GEMINI_API_KEY || "",
});

// 使用 Google 維護的 Flash alias，避免固定版本退役後整個聊天失效。
const GEMINI_MODEL =
  import.meta.env.VITE_GEMINI_MODEL || "gemini-flash-latest";

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
    emergencySummary: {
      type: Type.OBJECT,
      description: "從完整對話累積彙整的目前傷勢與救援需求；不可將推測當成使用者已確認的事實",
      properties: {
        hasInjuries: { type: Type.BOOLEAN },
        injurySummary: { type: Type.STRING },
        injurySeverity: {
          type: Type.STRING,
          enum: ["unknown", "minor", "moderate", "severe", "critical"],
        },
        rescueNeeds: { type: Type.ARRAY, items: { type: Type.STRING } },
        isTrapped: { type: Type.BOOLEAN },
        mobilityStatus: {
          type: Type.STRING,
          enum: ["unknown", "mobile", "limited", "immobile"],
        },
        locationDetails: { type: Type.STRING },
        urgencyLevel: { type: Type.NUMBER, description: "1-10 的救援緊急程度" },
        confidence: { type: Type.NUMBER, description: "0-1 的資訊可信度" },
      },
      required: [
        "hasInjuries", "injurySummary", "injurySeverity", "rescueNeeds",
        "isTrapped", "mobilityStatus", "locationDetails", "urgencyLevel", "confidence",
      ],
    },
  },
  required: [
    "type",
    "riskLevel",
    "situationSummary",
    "immediateActions",
    "longTermAdvice",
    "survivalProbability",
    "emergencySummary",
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
    3. **情境適應**：根據最新的感測器與災害資料（${sensorContext}）判斷使用者生理與環境狀態。其中「最近地震」欄位是中央氣象署回報的最新震源資料，可直接引用回答使用者「剛剛地震多大」「震央在哪」這類詢問。
    4. **回應策略**：若使用者只是詢問災情/地震資訊（非求救），請在 'situationSummary' 直接回答事實（規模、震央、深度、發生時間），'immediateActions' 給予一般性安全提醒即可，不要硬問細節。若使用者描述受困或受傷，才進入完整應變流程。
    5. **結構化輸出**：始終返回 JSON 格式，包含即時行動步驟與生存率預估。
    6. **救援摘要**：'emergencySummary' 必須累積完整對話中使用者已提供的傷勢、受困、行動能力、位置細節與救援需求。未提供時用 unknown/空字串/空陣列，不可臆測。
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
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: contents,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: ANALYSIS_SCHEMA,
      },
    });

    const raw = response.text || "";
    if (!raw.trim()) {
      console.error("Gemini 回應為空，完整 response：", response);
      throw new Error("Gemini 回應為空（可能被安全過濾或超出配額）");
    }
    try {
      return JSON.parse(raw) as DisasterAnalysis;
    } catch (parseErr) {
      console.error("JSON 解析失敗，原始回應：", raw);
      throw new Error(`回應格式錯誤：${raw.slice(0, 100)}`);
    }
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    throw error;
  }
}
