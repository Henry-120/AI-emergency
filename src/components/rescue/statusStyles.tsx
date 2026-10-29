import type { StatusTone } from "../../services/caseStatus";

/**
 * 受難者狀況和地圖標記的外觀。狀況一律同時用形狀、文字、顏色表示
 * （DESIGN.md：優先順序不能只靠顏色），紅綠色盲也分得出受困、受傷、需要物資。
 */

/** 選取中的按鈕、收合後的狀況列。 */
export const TONE_SELECTED: Record<StatusTone, string> = {
  critical: "border-critical bg-critical-soft text-critical-text",
  high: "border-high bg-high-soft text-high-text",
  accent: "border-accent bg-surface-2 text-accent",
  safe: "border-safe bg-safe-soft text-safe-text",
  muted: "border-line bg-surface-2 text-ink",
};

export const TONE_GLYPH: Record<StatusTone, string> = {
  critical: "text-critical",
  high: "text-high",
  accent: "text-accent",
  safe: "text-safe",
  muted: "text-muted",
};

/** 使用者釘選的災情：水滴形大頭針（像 Google 地圖），顏色是災情分類的顏色。 */
export function createHazardPinElement(color: string, label: string): HTMLElement {
  const element = document.createElement("div");
  element.style.width = "26px";
  element.style.height = "34px";
  element.style.cursor = "pointer";
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", label);
  element.innerHTML = hazardPinSvg(color);
  return element;
}

export function hazardPinSvg(color: string): string {
  return (
    '<svg viewBox="0 0 26 34" width="26" height="34" aria-hidden="true">' +
    `<path d="M13 1C6.4 1 1 6.3 1 12.9 1 21.8 13 33 13 33s12-11.2 12-20.1C25 6.3 19.6 1 13 1Z" style="fill:${color};stroke:#fff;stroke-width:2"/>` +
    '<circle cx="13" cy="13" r="4.5" style="fill:#fff"/>' +
    "</svg>"
  );
}

/**
 * 藍牙收到的附近訊號：受困的求救是紅色三角形，其他求救是琥珀色菱形，存活訊號是藍色圓點。
 * 跟災情大頭針、救援端的案件標記都分得開。
 */
export function createNearbySignalElement(kind: "sos" | "survival", trapped: boolean, label: string): HTMLElement {
  const element = document.createElement("div");
  element.style.width = "22px";
  element.style.height = "22px";
  element.style.cursor = "pointer";
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", label);
  const shape = kind === "survival"
    ? '<circle cx="11" cy="11" r="7" style="fill:var(--accent)"/>'
    : trapped
      ? '<path d="M11 2 L20 18 H2 Z" style="fill:var(--critical)"/>'
      : '<path d="M11 2 L20 11 L11 20 L2 11 Z" style="fill:var(--high)"/>';
  element.innerHTML =
    `<svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true" style="stroke:#fff;stroke-width:2;stroke-linejoin:round">${shape}</svg>`;
  return element;
}
