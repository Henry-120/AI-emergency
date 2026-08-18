/**
 * GuardiaAI SOS 多跳中繼 - 求救頁面
 *
 * 從「附近的人」進入。跟一般聊天不同：對象不是特定某個人，而是「把求救丟進
 * 藍牙網路，讓沿路任何一個有網路的人幫忙轉出去」。
 *
 * 表單刻意精簡（緊急狀況下沒空慢慢填）：緊急度、是否受困、位置描述、
 * 傷勢摘要、救援需求、行動能力。GPS 位置與裝置電量是自動帶入的，不用填。
 *
 * 這幾項（緊急度/是否受困/位置/電量）會是**明文**送出——中繼的陌生人看得到，
 * 好讓附近願意幫忙的人能直接判斷、直接定位過去；傷勢摘要、救援需求、行動
 * 能力、真實姓名、醫療摘要則加密，只有救援端解得開。
 *
 * 按鍵配置照使用當下決定：
 *   - 這頁的使用者可能受傷、單手、手在發抖。所有選項都是 56px 以上的實體按鍵，
 *     不用捏準小圓點；緊急程度改成三顆大按鍵，比拖曳滑桿可靠得多。
 *   - 「送出求救」釘在畫面最下緣，不隨表單捲動。求救者不該因為沒捲到底而
 *     找不到送出鍵——這是全 App 唯一用滿版實心紅的按鍵。
 */

import React, { useState } from "react";
import {
  isSosEnabled,
  submitSos,
  subscribeSosStatus,
  getSosRecords,
} from "../../services/sos/sosRelay";
import { hasMedicalCard } from "../../services/medicalCardService";

interface Props {
  onBack: () => void;
  myLocation: { lat: number; lng: number } | null;
}

const MOBILITY_OPTIONS: Array<{ value: "unknown" | "mobile" | "limited" | "immobile"; label: string }> = [
  { value: "unknown", label: "不確定" },
  { value: "mobile", label: "能自行走動" },
  { value: "limited", label: "行動受限" },
  { value: "immobile", label: "完全無法移動" },
];

/**
 * 緊急程度。
 *
 * 底層協定仍然是 1–10 的數字，但要一個手在發抖的人把滑桿拖到「7」是不切實際的。
 * 這裡收斂成三個講人話的選項，各自對應一個代表值——收到求救的人要判斷的本來
 * 也只是「這個人有多急」，不是精確刻度。
 */
const URGENCY_OPTIONS: Array<{
  value: number;
  label: string;
  hint: string;
  /** 選中時的樣式。字串寫死，Tailwind CDN 才掃得到 */
  activeClass: string;
}> = [
  {
    value: 10,
    label: "危及生命",
    hint: "有立即生命危險，需要馬上救援",
    activeClass: "bg-critical-soft border-critical text-critical-text",
  },
  {
    value: 6,
    label: "緊急",
    hint: "受傷或受困，撐得住但需要幫忙",
    activeClass: "bg-high-soft border-high text-high-text",
  },
  {
    value: 3,
    label: "需要協助",
    hint: "目前安全，但無法自行脫困或離開",
    activeClass: "bg-surface-2 border-accent text-ink",
  },
];

const RESCUE_NEED_OPTIONS = ["醫療協助", "搬運/抬送", "清除障礙物", "飲水或食物", "其他"];

const STATUS_LABEL: Record<string, string> = {
  sending: "正在送出…",
  queued_offline: "已存好，等待附近有人幫忙轉出去…",
  uploaded: "已送到後端，等待確認…",
  delivered: "已確認送達，救援單位已收到",
  failed: "送出失敗，已自動排隊等待重試",
};

/** 送出狀態的顏色：成功走 safe、失敗走 critical、其餘是進行中的 high */
const STATUS_TONE: Record<string, string> = {
  delivered: "bg-safe-soft border-safe text-safe-text",
  failed: "bg-critical-soft border-critical text-critical-text",
};

/** 區塊標題。表單很長，沒有標題層次會讀成一團 */
function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <div className="mb-2 flex items-baseline gap-2 text-base font-bold text-ink">
      {children}
      {required && (
        <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-critical-text">
          必填
        </span>
      )}
    </div>
  );
}

/** 大面積可按的勾選列。原生 checkbox 只有 13px，受傷的手按不準 */
function ToggleRow({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex min-h-[56px] w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-base transition-colors ${
        checked ? "border-accent bg-surface-2 text-ink" : "border-line bg-surface text-muted"
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 text-sm font-black ${
          checked ? "border-accent bg-accent text-bg" : "border-line"
        }`}
      >
        {checked ? "✓" : ""}
      </span>
      <span className="flex-1">{children}</span>
    </button>
  );
}

export function SosPanel({ onBack, myLocation }: Props) {
  const [urgencyLevel, setUrgencyLevel] = useState(6);
  const [isTrapped, setIsTrapped] = useState(false);
  const [mobilityStatus, setMobilityStatus] = useState<"unknown" | "mobile" | "limited" | "immobile">("unknown");
  const [injurySummary, setInjurySummary] = useState("");
  const [rescueNeeds, setRescueNeeds] = useState<string[]>([]);
  const [locationDetails, setLocationDetails] = useState("");
  const [includeMedical, setIncludeMedical] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [activeMsgId, setActiveMsgId] = useState<string | null>(null);
  const [, forceUpdate] = useState(0);

  React.useEffect(() => subscribeSosStatus(() => forceUpdate((n) => n + 1)), []);

  const toggleRescueNeed = (need: string) => {
    setRescueNeeds((prev) => (prev.includes(need) ? prev.filter((n) => n !== need) : [...prev, need]));
  };

  const handleSend = async () => {
    if (!injurySummary.trim()) {
      setErrorMsg("請簡短描述你的傷勢或狀況");
      return;
    }
    if (!isSosEnabled()) {
      setErrorMsg("求救功能尚未啟用（後端尚未設定），請改用「附近的人」聯繫他人協助");
      return;
    }

    setSending(true);
    setErrorMsg("");
    try {
      const msgId = await submitSos({
        urgencyLevel,
        isTrapped,
        location: myLocation ?? undefined,
        locationDetails: locationDetails.trim(),
        injurySummary: injurySummary.trim(),
        rescueNeeds,
        mobilityStatus,
        includeMedical,
      });
      setActiveMsgId(msgId);
    } catch (err) {
      setErrorMsg("送出失敗：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSending(false);
    }
  };

  const activeRecord = activeMsgId
    ? getSosRecords().find((r) => r.msgId === activeMsgId)
    : undefined;

  return (
    <div className="command-surface flex h-screen flex-col overflow-hidden bg-bg text-ink">
      <header className="safe-area-top shrink-0 border-b border-line bg-surface px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            aria-label="返回附近的人"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl text-muted transition-colors active:bg-surface-2 active:text-ink"
          >
            ←
          </button>
          <div className="text-[1.0625rem] font-bold text-ink">求救</div>
        </div>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm leading-relaxed text-muted">
          {"緊急程度、是否受困、位置、裝置電量會直接讓附近幫忙轉發的人看到，方便他們判斷要不要直接過來幫忙；傷勢細節、救援需求、真實姓名與醫療資料則加密，只有救援單位解得開。"}
        </p>

        <div>
          <FieldLabel>緊急程度</FieldLabel>
          <div className="grid gap-2">
            {URGENCY_OPTIONS.map((opt) => {
              const active = urgencyLevel === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setUrgencyLevel(opt.value)}
                  className={`min-h-[64px] rounded-xl border px-4 py-3 text-left transition-colors ${
                    active ? opt.activeClass : "border-line bg-surface text-muted"
                  }`}
                >
                  <div className={`text-[1.0625rem] font-bold ${active ? "" : "text-ink"}`}>
                    {opt.label}
                  </div>
                  <div className="mt-0.5 text-sm">{opt.hint}</div>
                </button>
              );
            })}
          </div>
        </div>

        <ToggleRow checked={isTrapped} onChange={setIsTrapped}>
          受困，出不去
        </ToggleRow>

        <div>
          <FieldLabel>行動能力</FieldLabel>
          <div className="grid grid-cols-2 gap-2">
            {MOBILITY_OPTIONS.map((opt) => {
              const active = mobilityStatus === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setMobilityStatus(opt.value)}
                  className={`min-h-[56px] rounded-xl border px-3 text-base font-medium transition-colors ${
                    active
                      ? "border-accent bg-surface-2 text-ink"
                      : "border-line bg-surface text-muted"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <FieldLabel required>傷勢摘要</FieldLabel>
          <textarea
            value={injurySummary}
            onChange={(e) => setInjurySummary(e.target.value)}
            placeholder="例如：右腳受傷無法行走，頭部有撞擊"
            aria-label="傷勢摘要"
            className="h-24 w-full resize-none rounded-xl border border-line bg-surface px-3.5 py-3 text-base text-ink placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <p className="mt-1.5 text-sm text-muted">可以用手機鍵盤的語音輸入，不必打字。</p>
        </div>

        <div>
          <FieldLabel>需要什麼協助</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {RESCUE_NEED_OPTIONS.map((need) => {
              const active = rescueNeeds.includes(need);
              return (
                <button
                  key={need}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleRescueNeed(need)}
                  className={`min-h-[48px] rounded-xl border px-4 text-base font-medium transition-colors ${
                    active
                      ? "border-accent bg-surface-2 text-ink"
                      : "border-line bg-surface text-muted"
                  }`}
                >
                  {need}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <FieldLabel>位置描述</FieldLabel>
          <input
            value={locationDetails}
            onChange={(e) => setLocationDetails(e.target.value)}
            placeholder="例如：三樓，樓梯間旁"
            aria-label="位置描述"
            className="min-h-[56px] w-full rounded-xl border border-line bg-surface px-3.5 text-base text-ink placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <p className="mt-1.5 text-sm text-muted">
            {myLocation
              ? "已自動附上 GPS 座標，這裡補充樓層或方位就好。"
              : "目前抓不到 GPS，這段文字會是救援端唯一的位置線索。"}
          </p>
        </div>

        <ToggleRow checked={includeMedical} onChange={setIncludeMedical}>
          附上醫療卡摘要（血型、藥物過敏、慢性病）
          {!hasMedicalCard() && (
            <span className="mt-0.5 block text-sm text-muted">尚未填寫醫療卡</span>
          )}
        </ToggleRow>
      </div>

      {/* 送出區釘在拇指熱區。狀態訊息放在按鍵正上方——按下去之後眼睛不用移開 */}
      <div className="safe-area-bottom shrink-0 space-y-2.5 border-t border-line bg-surface px-4 pt-3">
        {errorMsg && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-critical bg-critical-soft px-3.5 py-2.5"
          >
            <p className="flex-1 text-sm font-medium text-critical-text">{errorMsg}</p>
            <button
              onClick={() => setErrorMsg("")}
              aria-label="關閉這則訊息"
              className="-my-1.5 -mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg text-critical-text"
            >
              ✕
            </button>
          </div>
        )}

        {activeRecord && (
          <div
            aria-live="polite"
            className={`rounded-xl border px-3.5 py-2.5 text-sm font-medium ${
              STATUS_TONE[activeRecord.status] ?? "bg-high-soft border-high text-high-text"
            }`}
          >
            {STATUS_LABEL[activeRecord.status] ?? activeRecord.status}
            {activeRecord.error && `（${activeRecord.error}）`}
          </div>
        )}

        <button
          onClick={handleSend}
          disabled={sending}
          className="min-h-[64px] w-full rounded-xl bg-critical text-[1.25rem] font-black text-white transition-colors active:opacity-80 disabled:bg-surface-2 disabled:text-muted"
        >
          {sending ? "送出中…" : "送出求救"}
        </button>
      </div>
    </div>
  );
}
