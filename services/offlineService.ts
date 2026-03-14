// src/services/offlineService.ts
import { DisasterAnalysis } from "../types";

const OFFLINE_SOP: Record<string, string> = {
  "地震": "請執行『趴下、掩護、穩住』。遠離窗戶，保護頭部。若在室內，留在原地直到搖晃停止。",
  "出口": "若出口受阻，請嘗試尋找其他通風口。利用硬物敲擊牆壁或管道發出求救訊號，避免大聲喊叫耗費氧氣。",
  "受困": "保持冷靜並節省體力。若有哨子請吹哨，或規律敲擊金屬管。等待救援人員靠近。",
  "呼吸": "盡量低姿勢爬行，找尋衣物遮住口鼻。若有水源可將衣物打濕。",
  "火": "低姿勢逃生。開門前先觸摸門把，若發燙切勿開門。尋找無煙的逃生路線。",
  "傷": "先嘗試直接加壓止血。若肢體骨折，嘗試用硬板固定。保持傷口清潔。"
};

export function getOfflineAnalysis(userInput: string): DisasterAnalysis {
  // 尋找匹配的關鍵字
  const matchedKey = Object.keys(OFFLINE_SOP).find(key => userInput.includes(key));
  const advice = matchedKey ? OFFLINE_SOP[matchedKey] : "目前處於離線模式。請嘗試輸入關鍵字（如：地震、受困、傷情）以獲取預載 SOP。";

  return {
    type: "地震" as any,
    riskLevel: 8,
    situationSummary: `[本地應變] 偵測到關鍵字：${matchedKey || '未知'}`,
    immediateActions: [
      {
        title: "離線應變指令",
        description: advice,
        priority: "CRITICAL"
      }
    ],
    survivalProbability: 50,
    longTermAdvice: "一旦恢復網路，系統將自動啟動 AI 詳細分析。請保持手機電力。",
    missingInfoRequests: []
  };
}