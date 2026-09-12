import React from "react";
import {
  THEME_ICONS,
  THEME_LABELS,
  THEME_OPTIONS,
  useThemePreference,
} from "../../services/themeService";

/**
 * 外觀三選一，電腦版的 ☰ 選單與手機版的「更多」共用。
 * 切換後不關選單，讓使用者直接看到換色的結果。
 */
export function ThemePicker() {
  const [theme, setTheme] = useThemePreference();

  return (
    <div className="px-3 py-3">
      <div className="flex items-center gap-3">
        <i
          className={`fas ${THEME_ICONS[theme]} w-5 text-center text-accent`}
          aria-hidden="true"
        ></i>
        <span className="text-sm font-semibold text-ink">外觀</span>
        <div
          role="radiogroup"
          aria-label="外觀"
          className="ml-auto flex rounded-xl bg-surface-2 p-1"
        >
          {THEME_OPTIONS.map((option) => (
            <button
              key={option}
              role="radio"
              aria-checked={theme === option}
              onClick={() => setTheme(option)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                theme === option ? "bg-primary text-primary-ink" : "text-ink"
              }`}
            >
              {THEME_LABELS[option]}
            </button>
          ))}
        </div>
      </div>
      {/* 低電量規則靠 Battery API，iPhone 與 Safari 沒有，所以只在支援時提起。 */}
      <p className="mt-1.5 pl-8 text-[11px] leading-snug text-muted">
        {"getBattery" in navigator
          ? "自動：跟隨系統；電量低於 20% 且未充電時改用夜間省電"
          : "自動：跟隨系統的淺色／深色設定"}
      </p>
    </div>
  );
}
