import React, { useEffect, useState } from "react";
import {
  CaseStatus,
  readPendingSelfStatus,
  SELF_STATUS_OPTIONS,
  SelfStatus,
  STATUS_META,
} from "../../services/caseStatus";
import { fetchMyCase, MyCase, submitMyStatus } from "../../services/myStatusService";
import { TONE_GLYPH, TONE_SELECTED } from "./statusStyles";

function clock(iso: string | null): string {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return "";
  return new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
}

function describe(myCase: MyCase | null, queued: boolean): string {
  if (queued) return "已記在手機上，恢復連線後會自動送出。";
  if (!myCase?.condition) return "按一下最符合你現在的狀況，搜救人員會看到你的狀況和位置。";
  const time = clock(myCase.conditionUpdatedAt);
  const source =
    myCase.conditionSource === "self"
      ? `${time} 由你本人更新。`
      : `AI 從對話判斷你「${STATUS_META[myCase.condition].short}」，不對的話請直接按正確的狀況。`;
  if (!myCase.requiresRescue) return source;
  return myCase.hasLocation
    ? `${source}搜救人員看得到你的狀況和位置。`
    : `${source}還沒有你的位置，請開啟定位，搜救人員才找得到你。`;
}

/**
 * 地圖上的「我現在的狀態」。按一下就送出，不必打字；已經有狀態時收合成一列，
 * 把空間留給地圖和清單。
 */
export function MyStatusCard({
  location,
  onChanged,
}: {
  location: { lat: number; lng: number } | null;
  /** 狀況送到後端之後呼叫。 */
  onChanged?: () => void;
}) {
  const [myCase, setMyCase] = useState<MyCase | null>(null);
  const [queuedStatus, setQueuedStatus] = useState<SelfStatus | null>(
    () => readPendingSelfStatus()?.condition ?? null,
  );
  const [saving, setSaving] = useState<SelfStatus | null>(null);
  const [expanded, setExpanded] = useState(() => !readPendingSelfStatus());

  useEffect(() => {
    let cancelled = false;
    fetchMyCase()
      .then((result) => {
        if (cancelled) return;
        setMyCase(result);
        if (result.condition) setExpanded(false);
      })
      .catch(() => {
        // 讀不到（離線、後端還沒更新）時照樣可以按，按下去會先存在手機上。
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 離線時按的狀態還沒送到後端，先顯示使用者自己選的。
  const current: CaseStatus | null = queuedStatus ?? myCase?.condition ?? null;

  const choose = async (status: SelfStatus) => {
    if (saving) return;
    setSaving(status);
    const { myCase: saved, queued } = await submitMyStatus(status, location);
    setSaving(null);
    if (queued) {
      setQueuedStatus(status);
    } else {
      setQueuedStatus(null);
      setMyCase(saved);
      onChanged?.();
    }
    setExpanded(false);
  };

  const currentMeta = current ? STATUS_META[current] : null;

  return (
    <section aria-labelledby="my-status-title" className="rounded-xl bg-surface p-3 shadow-[var(--elev-soft)]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="my-status-title" className="text-xs font-bold text-muted">
          我現在的狀態
        </h2>
        {!expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="tappable -my-2 min-h-11 px-2 text-xs font-bold text-accent"
          >
            更改
          </button>
        )}
      </div>

      {expanded || !currentMeta ? (
        <div role="radiogroup" aria-labelledby="my-status-title" className="grid gap-1.5">
          {SELF_STATUS_OPTIONS.map((status) => {
            const meta = STATUS_META[status];
            const selected = current === status;
            return (
              <button
                key={status}
                role="radio"
                aria-checked={selected}
                disabled={saving !== null}
                onClick={() => void choose(status)}
                className={`tappable flex min-h-11 items-center gap-2.5 rounded-xl border px-3 text-left text-sm transition-colors disabled:opacity-60 ${
                  selected ? `${TONE_SELECTED[meta.tone]} font-bold` : "border-line bg-surface text-ink"
                }`}
              >
                <span aria-hidden="true" className={`w-4 text-center ${TONE_GLYPH[meta.tone]}`}>
                  {meta.glyph}
                </span>
                <span>{meta.label}</span>
                {saving === status ? (
                  <span className="ml-auto text-xs">送出中…</span>
                ) : selected ? (
                  <span className="ml-auto text-xs">已選</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : (
        <div
          className={`flex min-h-11 items-center gap-2.5 rounded-xl border px-3 text-sm font-bold ${TONE_SELECTED[currentMeta.tone]}`}
        >
          <span aria-hidden="true" className={TONE_GLYPH[currentMeta.tone]}>
            {currentMeta.glyph}
          </span>
          {currentMeta.label}
        </div>
      )}

      <p className="mt-2 text-xs leading-relaxed text-muted" aria-live="polite">
        {describe(myCase, queuedStatus !== null)}
      </p>
    </section>
  );
}
