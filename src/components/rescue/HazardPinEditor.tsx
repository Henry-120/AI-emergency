import React, { useState } from "react";
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  DISASTER_CATEGORIES,
  DisasterCategory,
} from "../../services/disasterCategories";

/**
 * 釘選災情的面板：地圖中央有十字，使用者移動地圖對準位置，選一個分類、可以補一句說明。
 * 放在地圖下方而不是蓋在地圖上，十字才不會被面板擋住。
 */
export function HazardPinEditor({
  mode,
  initialCategory,
  initialNote = "",
  saving,
  error,
  onCategoryChange,
  onCancel,
  onSave,
}: {
  mode: "create" | "edit";
  initialCategory?: DisasterCategory;
  initialNote?: string;
  saving: boolean;
  error: string;
  /** 讓地圖中央的十字跟著換成選的分類顏色 */
  onCategoryChange: (category: DisasterCategory) => void;
  onCancel: () => void;
  onSave: (category: DisasterCategory, note: string) => void;
}) {
  const [category, setCategory] = useState<DisasterCategory | null>(initialCategory ?? null);
  const [note, setNote] = useState(initialNote);

  const choose = (next: DisasterCategory) => {
    setCategory(next);
    onCategoryChange(next);
  };

  return (
    <section
      aria-labelledby="hazard-pin-title"
      className="rounded-xl border border-line bg-surface p-3 shadow-[var(--elev-soft)]"
    >
      <h2 id="hazard-pin-title" className="text-sm font-bold text-ink">
        {mode === "edit" ? "修改災情標記" : "標記災情"}：移動地圖，把十字對準災情的位置
      </h2>
      <div role="radiogroup" aria-label="災情分類" className="mt-2 flex flex-wrap gap-1.5">
        {DISASTER_CATEGORIES.map((item) => {
          const selected = category === item;
          return (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => choose(item)}
              className={`tappable inline-flex min-h-11 items-center gap-1.5 rounded-full border-2 px-3 text-sm ${
                selected ? "font-bold text-ink" : "text-muted"
              }`}
              style={{
                borderColor: CATEGORY_COLORS[item],
                backgroundColor: selected ? `${CATEGORY_COLORS[item]}26` : undefined,
              }}
            >
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: CATEGORY_COLORS[item] }}
              />
              {CATEGORY_LABELS[item]}
            </button>
          );
        })}
      </div>
      <label className="mt-2 block">
        <span className="sr-only">補充說明（選填）</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={200}
          rows={2}
          placeholder="補充說明（選填），例如：路面裂開，車子過不去"
          className="w-full resize-none rounded-xl border border-line bg-surface-2 p-2 text-sm text-ink placeholder:text-muted"
        />
      </label>
      {error && (
        <p role="alert" className="mt-1 text-xs text-critical-text">
          {error}
        </p>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="tappable min-h-11 rounded-xl border border-line bg-surface text-sm font-bold text-ink"
        >
          取消
        </button>
        <button
          type="button"
          disabled={!category || saving}
          onClick={() => category && onSave(category, note)}
          className="tappable min-h-11 rounded-xl bg-primary text-sm font-bold text-white disabled:opacity-50"
        >
          {saving ? "儲存中…" : mode === "edit" ? "儲存變更" : "標記在這裡"}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-muted">
        所有人都看得到這個標記，但看不到是誰標的。請只標記親眼看到的災情。
      </p>
    </section>
  );
}
