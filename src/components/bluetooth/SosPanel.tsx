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

const RESCUE_NEED_OPTIONS = ["醫療協助", "搬運/抬送", "清除障礙物", "飲水或食物", "其他"];

const STATUS_LABEL: Record<string, string> = {
  sending: "正在送出…",
  queued_offline: "已存好，等待附近有人幫忙轉出去…",
  uploaded: "已送到後端，等待確認…",
  delivered: "已確認送達，救援單位已收到",
  failed: "送出失敗，已自動排隊等待重試",
};

export function SosPanel({ onBack, myLocation }: Props) {
  const [urgencyLevel, setUrgencyLevel] = useState(5);
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
    <div className="h-screen flex flex-col bg-[#020617] overflow-hidden">
      <header className="glass-panel safe-area-top px-4 py-3 flex items-center gap-3 border-b border-white/5">
        <button onClick={onBack} className="text-slate-400 hover:text-white text-sm">
          ← 返回
        </button>
        <div className="text-white font-bold">求救</div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <p className="text-[12px] text-slate-400 leading-relaxed">
          緊急度、是否受困、位置、裝置電量會直接讓附近幫忙轉發的人看到，方便他們判斷
          要不要直接過來幫忙；傷勢細節、救援需求、真實姓名與醫療資料則加密，只有救援
          單位解得開。
        </p>

        <div>
          <div className="flex items-center justify-between text-[12px] text-slate-400 mb-2">
            <span>緊急度</span>
            <span className="text-rose-300 font-semibold">{urgencyLevel} / 10</span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            value={urgencyLevel}
            onChange={(e) => setUrgencyLevel(Number(e.target.value))}
            className="w-full"
          />
        </div>

        <label className="flex items-center gap-2 bg-slate-900/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200">
          <input type="checkbox" checked={isTrapped} onChange={(e) => setIsTrapped(e.target.checked)} />
          受困，出不去
        </label>

        <div>
          <div className="text-[12px] text-slate-400 mb-2">行動能力</div>
          <div className="grid grid-cols-2 gap-2">
            {MOBILITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setMobilityStatus(opt.value)}
                className={`px-3 py-2 rounded-xl text-[13px] border ${
                  mobilityStatus === opt.value
                    ? "bg-amber-500/20 text-amber-200 border-amber-500/40"
                    : "bg-slate-900/60 text-slate-300 border-white/10"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[12px] text-slate-400 mb-2">傷勢摘要（可用語音輸入）</div>
          <textarea
            value={injurySummary}
            onChange={(e) => setInjurySummary(e.target.value)}
            placeholder="例如：右腳受傷無法行走，頭部有撞擊"
            className="w-full h-20 bg-slate-900/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-white resize-none"
          />
        </div>

        <div>
          <div className="text-[12px] text-slate-400 mb-2">需要什麼協助（可複選）</div>
          <div className="flex flex-wrap gap-2">
            {RESCUE_NEED_OPTIONS.map((need) => (
              <button
                key={need}
                onClick={() => toggleRescueNeed(need)}
                className={`px-3 py-1.5 rounded-full text-[12px] border ${
                  rescueNeeds.includes(need)
                    ? "bg-rose-500/20 text-rose-200 border-rose-500/40"
                    : "bg-slate-900/60 text-slate-300 border-white/10"
                }`}
              >
                {need}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[12px] text-slate-400 mb-2">
            位置描述{myLocation ? "（已自動附上 GPS 座標）" : "（目前抓不到 GPS，仍會送出）"}
          </div>
          <input
            value={locationDetails}
            onChange={(e) => setLocationDetails(e.target.value)}
            placeholder="例如：三樓，樓梯間旁"
            className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
          />
        </div>

        <label className="flex items-center gap-2 bg-slate-900/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={includeMedical}
            onChange={(e) => setIncludeMedical(e.target.checked)}
          />
          附上醫療卡摘要（血型、藥物過敏、慢性病）
          {!hasMedicalCard() && (
            <span className="text-[11px] text-slate-500">（尚未填寫醫療卡）</span>
          )}
        </label>

        {errorMsg && (
          <div className="px-3 py-2 bg-rose-900/30 text-rose-200 text-[12px] rounded-xl border border-rose-500/20">
            {errorMsg}
          </div>
        )}

        {activeRecord && (
          <div className="px-3 py-2 bg-amber-900/20 text-amber-200 text-[12px] rounded-xl border border-amber-500/20">
            {STATUS_LABEL[activeRecord.status] ?? activeRecord.status}
            {activeRecord.error && `（${activeRecord.error}）`}
          </div>
        )}

        <button
          onClick={handleSend}
          disabled={sending}
          className="w-full px-4 py-3 rounded-xl text-sm font-semibold bg-rose-500/20 text-rose-200 border border-rose-500/30 disabled:opacity-50"
        >
          {sending ? "送出中…" : "送出求救"}
        </button>
      </div>
    </div>
  );
}
