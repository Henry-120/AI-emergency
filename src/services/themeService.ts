import { useSyncExternalStore } from "react";

/**
 * 外觀主題：自動／日間／夜間。
 *
 * 配色全在 index.html：<html data-theme="light|dark"> 是使用者固定的主題；
 * 沒有 data-theme 時跟隨系統明暗，低電量時再由 index.html 的腳本加上 theme-dark。
 * 這裡只負責記住選擇、改 <html> 上的標記。開頁時的套用也寫在 index.html——
 * 要趕在第一次繪製前執行，否則重新整理會先閃一下系統主題。
 */
export type ThemePreference = "auto" | "light" | "dark";

/** index.html 的開頁腳本讀同一個 key，改名要兩邊一起改。 */
export const THEME_STORAGE_KEY = "guardia_theme";

export const THEME_OPTIONS: ThemePreference[] = ["auto", "light", "dark"];

export const THEME_LABELS: Record<ThemePreference, string> = {
  auto: "自動",
  light: "日間",
  dark: "夜間",
};

export const THEME_ICONS: Record<ThemePreference, string> = {
  auto: "fa-circle-half-stroke",
  light: "fa-sun",
  dark: "fa-moon",
};

/** 沒存過或不認得的值一律當作自動。 */
export function parseThemePreference(raw: string | null): ThemePreference {
  return raw === "light" || raw === "dark" ? raw : "auto";
}

function readStoredPreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // 無痕模式或測試環境拿不到 localStorage
    return "auto";
  }
}

let current: ThemePreference = readStoredPreference();
const listeners = new Set<() => void>();

function applyToDocument(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference === "auto") {
    root.removeAttribute("data-theme");
    // 回到自動時馬上重判一次低電量規則，不必等下一次電量變化事件。
    (window as any).__guardiaApplyBatteryTheme?.();
    return;
  }
  root.setAttribute("data-theme", preference);
  // 低電量加上的 theme-dark 會蓋過 data-theme="light"，固定日間時要拿掉。
  if (preference === "light") root.classList.remove("theme-dark");
}

export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === "auto") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // 存不了就只套用這一次，重新整理後回到自動。
  }
  applyToDocument(preference);
  current = preference;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 報頭與「更多」選單共用同一份狀態，任一邊切換，另一邊跟著更新。 */
export function useThemePreference() {
  const preference = useSyncExternalStore(subscribe, () => current);
  return [preference, setThemePreference] as const;
}
