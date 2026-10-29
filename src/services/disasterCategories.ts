/**
 * 救援地圖上的災情分類（五類，各有自己的顏色）。
 * AI 整理的災情回報區域和使用者自己釘選的災情標記共用同一套，圖例只有一份。
 * 分類跟後端 schemas.FieldReportAnalysis.category、HazardPinCategory 相同。
 */

export type DisasterCategory = "road" | "building" | "fire" | "utility" | "other";

export const DISASTER_CATEGORIES: DisasterCategory[] = ["road", "building", "fire", "utility", "other"];

export const CATEGORY_LABELS: Record<DisasterCategory, string> = {
  road: "道路",
  building: "建物",
  fire: "火災",
  utility: "民生設施",
  other: "其他觀察",
};

export const CATEGORY_COLORS: Record<DisasterCategory, string> = {
  road: "#f97316",
  building: "#8b5cf6",
  fire: "#ef4444",
  utility: "#0ea5e9",
  other: "#64748b",
};
