import React, { useEffect, useState } from "react";
import { MedicalCard } from "../../types";
import { getMedicalCard, loadMedicalCard, saveMedicalCard } from "../../services/medicalCardService";
import { joinFullName } from "../../services/personName";

const BLOOD_TYPES = ["A", "B", "O", "AB", "不確定"];

// 欄位定義：用於渲染表單與檢視
const TEXT_FIELDS: {
  key: keyof MedicalCard;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  type?: string;
}[] = [
  { key: "drugAllergies", label: "藥物過敏", placeholder: "如：盤尼西林、阿斯匹靈", multiline: true },
  { key: "foodAllergies", label: "食物 / 其他過敏", placeholder: "如：海鮮、花生、乳膠", multiline: true },
  { key: "chronicConditions", label: "慢性病史", placeholder: "如：高血壓、糖尿病、氣喘", multiline: true },
  { key: "currentMedications", label: "目前用藥", placeholder: "如：每日服用之藥物", multiline: true },
  { key: "medicalDevices", label: "體內醫療裝置", placeholder: "如：心律調節器、人工關節" },
];

export function MedicalCardPage({ onBack }: { onBack: () => void }) {
  const [card, setCard] = useState<MedicalCard>(() => getMedicalCard());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<MedicalCard>(card);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!navigator.onLine) return;
    loadMedicalCard()
      .then((onlineCard) => {
        setCard(onlineCard);
        setDraft(onlineCard);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "線上醫療卡載入失敗"));
  }, []);

  const startEdit = () => {
    setDraft(card);
    setEditing(true);
    setSaved(false);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await saveMedicalCard(draft);
      setCard(result);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "醫療卡儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  const set = (key: keyof MedicalCard, value: string | boolean) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  // 姓、名分開填；上方卡片顯示的全名跟著即時重組。
  const setNamePart = (key: "lastName" | "firstName", value: string) =>
    setDraft((prev) => {
      const next = { ...prev, [key]: value };
      return { ...next, fullName: joinFullName(next.lastName, next.firstName) };
    });

  // 欄位若與卡片同為 surface 底色會整個隱形；照 DESIGN.md 的輸入框規格用 surface-2 底加細框線。
  const inputClass =
    "w-full min-w-0 px-3 py-2.5 rounded-lg border border-line bg-surface-2 text-ink text-base sm:text-sm focus:outline-none focus:ring-2";

  // ---------- 檢視模式 ----------
  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="flex min-w-0 items-start justify-between gap-3 py-2.5 border-b border-line">
      <span className="text-xs text-muted shrink-0">{label}</span>
      <span className="min-w-0 break-words text-sm text-ink text-right whitespace-pre-wrap">
        {value || <span className="text-muted">—</span>}
      </span>
    </div>
  );

  return (
    <div className="h-full min-h-0 flex flex-col bg-bg text-ink overflow-hidden">
      {/* Header */}
      <header className="safe-area-top flex min-w-0 items-center justify-between gap-2 px-3 py-2 sm:px-4 sm:py-3 bg-bg border-b border-line shrink-0">
        <button
          onClick={onBack}
          className="tappable min-h-11 shrink-0 text-muted hover:text-ink text-sm flex items-center gap-2"
        >
          <i className="fas fa-arrow-left"></i> 返回
        </button>
        <span className="min-w-0 truncate font-bold text-sm sm:text-base flex items-center gap-2">
          <i className="fas fa-heart-pulse text-critical-text"></i> 緊急醫療卡
        </span>
        {editing ? (
          <button
            onClick={handleSave}
            disabled={saving}
            className="tappable min-h-11 shrink-0 px-3 py-1.5 rounded-lg bg-primary text-primary-ink text-xs font-bold hover:bg-primary"
          >
            {saving ? "儲存中…" : "儲存"}
          </button>
        ) : (
          <button
            onClick={startEdit}
            className="tappable min-h-11 shrink-0 px-3 py-1.5 rounded-lg bg-surface-2 text-ink text-xs font-semibold"
          >
            <i className="fas fa-pen mr-1"></i> 編輯
          </button>
        )}
      </header>

      <div className="pb-[var(--tabbar-clearance)] min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4 sm:py-5 safe-area-bottom">
        <div className="max-w-md mx-auto">
          {saved && (
            <div className="mb-4 text-xs text-safe-text bg-safe-soft px-3 py-2 rounded-lg">
              ✓ 醫療卡已儲存（離線可用）
            </div>
          )}
          {error && (
            <div className="mb-4 text-xs text-critical-text bg-critical-soft px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          {/* 醫療卡頂部摘要 */}
          <div className="mb-5 rounded-2xl bg-critical-soft p-5 shadow-[var(--elev-soft)]">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-critical-text">
                Emergency Medical Card
              </h2>
              <i
                className="fas fa-heart-pulse text-critical-text"
                aria-hidden="true"
              ></i>
            </div>
            <div className="text-2xl font-bold text-ink">
              {(editing ? draft.fullName : card.fullName) || "未填寫姓名"}
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {(editing ? draft.bloodType : card.bloodType) && (
                <span className="px-3 py-1 rounded-full bg-critical-soft text-critical-text text-xs font-bold">
                  血型 {editing ? draft.bloodType : card.bloodType}
                </span>
              )}
              {(editing ? draft.birthday : card.birthday) && (
                <span className="px-3 py-1 rounded-full bg-surface-2 text-ink text-xs">
                  生日 {editing ? draft.birthday : card.birthday}
                </span>
              )}
              {(editing ? draft.organDonor : card.organDonor) && (
                <span className="px-3 py-1 rounded-full bg-safe-soft text-safe-text text-xs">
                  器官捐贈者
                </span>
              )}
            </div>
          </div>

          {editing ? (
            /* ---------- 編輯模式 ---------- */
            <div className="space-y-4">
              <Section title="基本資料">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="姓">
                    <input className={inputClass} value={draft.lastName} autoComplete="family-name"
                      onChange={(e) => setNamePart("lastName", e.target.value)} placeholder="王" />
                  </Field>
                  <Field label="名">
                    <input className={inputClass} value={draft.firstName} autoComplete="given-name"
                      onChange={(e) => setNamePart("firstName", e.target.value)} placeholder="小明" />
                  </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="生日">
                    <input type="date" className={inputClass} value={draft.birthday}
                      onChange={(e) => set("birthday", e.target.value)} />
                  </Field>
                  <Field label="性別">
                    <select className={inputClass} value={draft.gender}
                      onChange={(e) => set("gender", e.target.value)}>
                      <option value="">未選擇</option>
                      <option value="男">男</option>
                      <option value="女">女</option>
                      <option value="其他">其他</option>
                    </select>
                  </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field label="血型">
                    <select className={inputClass} value={draft.bloodType}
                      onChange={(e) => set("bloodType", e.target.value)}>
                      <option value="">未選擇</option>
                      {BLOOD_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </Field>
                  <Field label="身高(cm)">
                    <input type="number" className={inputClass} value={draft.heightCm}
                      onChange={(e) => set("heightCm", e.target.value)} placeholder="170" />
                  </Field>
                  <Field label="體重(kg)">
                    <input type="number" className={inputClass} value={draft.weightKg}
                      onChange={(e) => set("weightKg", e.target.value)} placeholder="65" />
                  </Field>
                </div>
              </Section>

              <Section title="醫療資訊">
                {TEXT_FIELDS.map((f) => {
                  const value = draft[f.key] as string;
                  const isNone = value === "無";
                  return (
                    <div key={f.key}>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs text-muted">{f.label}</label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isNone}
                            onChange={(e) => set(f.key, e.target.checked ? "無" : "")}
                            className="w-3.5 h-3.5 accent-amber-500"
                          />
                          <span className="text-xs text-muted">無</span>
                        </label>
                      </div>
                      {f.multiline ? (
                        <textarea
                          className={`${inputClass} disabled:opacity-40`}
                          rows={2}
                          value={isNone ? "" : value}
                          disabled={isNone}
                          onChange={(e) => set(f.key, e.target.value)}
                          placeholder={isNone ? "已勾選「無」" : f.placeholder}
                        />
                      ) : (
                        <input
                          className={`${inputClass} disabled:opacity-40`}
                          value={isNone ? "" : value}
                          disabled={isNone}
                          onChange={(e) => set(f.key, e.target.value)}
                          placeholder={isNone ? "已勾選「無」" : f.placeholder}
                        />
                      )}
                    </div>
                  );
                })}
                <label className="flex items-center gap-2 py-1 cursor-pointer">
                  <input type="checkbox" checked={draft.organDonor}
                    onChange={(e) => set("organDonor", e.target.checked)}
                    className="w-4 h-4 accent-amber-500" />
                  <span className="text-sm text-ink">我是器官捐贈者</span>
                </label>
              </Section>

              <Section title="緊急聯絡人">
                <Field label="姓名">
                  <input className={inputClass} value={draft.emergencyContactName}
                    onChange={(e) => set("emergencyContactName", e.target.value)} placeholder="聯絡人姓名" />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="電話">
                    <input type="tel" className={inputClass} value={draft.emergencyContactPhone}
                      onChange={(e) => set("emergencyContactPhone", e.target.value)} placeholder="0912-345-678" />
                  </Field>
                  <Field label="關係">
                    <input className={inputClass} value={draft.emergencyContactRelation}
                      onChange={(e) => set("emergencyContactRelation", e.target.value)} placeholder="如：父母、配偶" />
                  </Field>
                </div>
              </Section>

              <Section title="其他">
                <Field label="身分證 / 健保資訊">
                  <input className={inputClass} value={draft.nationalId}
                    onChange={(e) => set("nationalId", e.target.value)} placeholder="選填" />
                </Field>
                <Field label="備註">
                  <textarea className={inputClass} rows={2} value={draft.notes}
                    onChange={(e) => set("notes", e.target.value)} placeholder="其他需告知醫護的資訊" />
                </Field>
              </Section>

              <button onClick={handleSave} disabled={saving}
                className="tappable w-full py-3 rounded-xl bg-primary text-primary-ink font-bold text-sm hover:bg-primary">
                {saving ? "儲存中…" : "儲存醫療卡"}
              </button>
            </div>
          ) : (
            /* ---------- 檢視模式 ---------- */
            <div className="rounded-2xl bg-surface px-4 py-2 shadow-[var(--elev-soft)]">
              <Row label="性別" value={card.gender} />
              <Row label="身高 / 體重"
                value={[card.heightCm && `${card.heightCm} cm`, card.weightKg && `${card.weightKg} kg`].filter(Boolean).join(" / ")} />
              <Row label="藥物過敏" value={card.drugAllergies} />
              <Row label="食物 / 其他過敏" value={card.foodAllergies} />
              <Row label="慢性病史" value={card.chronicConditions} />
              <Row label="目前用藥" value={card.currentMedications} />
              <Row label="體內醫療裝置" value={card.medicalDevices} />
              <Row label="緊急聯絡人"
                value={[card.emergencyContactName, card.emergencyContactPhone, card.emergencyContactRelation].filter(Boolean).join(" / ")} />
              <Row label="身分證 / 健保" value={card.nationalId} />
              <Row label="備註" value={card.notes} />
              {card.updatedAt && (
                <p className="text-[10px] text-muted pt-3 pb-1 text-center">
                  最後更新：{new Date(card.updatedAt).toLocaleString("zh-TW")}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-[var(--elev-soft)]">
      <h3 className="text-xs font-bold text-accent uppercase tracking-wider mb-3">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-muted mb-1.5">{label}</label>
      {children}
    </div>
  );
}
