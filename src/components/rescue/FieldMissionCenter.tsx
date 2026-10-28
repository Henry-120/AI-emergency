import React, { useEffect, useState } from "react";
import { fetchFieldMissions, fetchFieldTeam, RescueMission, RescueTeam, updateFieldMissionStatus } from "../../services/rescueService";

const NEXT_MISSION_STATUSES: Record<string, string[]> = {
  "待隊伍確認": ["已接受", "已拒絕"],
  "已接受": ["前往現場"],
  "前往現場": ["已抵達"],
  "已抵達": ["任務完成"],
  "任務完成": [],
  "已拒絕": [],
};

export function FieldMissionCenter({ username, onLogout }: { username: string; onLogout: () => void }) {
  const [team, setTeam] = useState<RescueTeam | null>(null);
  const [missions, setMissions] = useState<RescueMission[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const [teamResult, missionResult] = await Promise.all([fetchFieldTeam(), fetchFieldMissions()]);
      setTeam(teamResult);
      setMissions(missionResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "外勤任務載入失敗");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const updateStatus = async (mission: RescueMission, status: string) => {
    const note = notes[mission.id] || "";
    if (["任務完成", "已拒絕"].includes(status) && !note.trim()) {
      setError(status === "任務完成" ? "請先填寫現場處置結果" : "請先填寫無法接受任務的原因");
      return;
    }
    setBusyId(mission.id);
    setError("");
    try {
      const updated = await updateFieldMissionStatus(mission.id, status, note);
      setMissions((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNotes((current) => ({ ...current, [mission.id]: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "任務狀態更新失敗");
    } finally {
      setBusyId("");
    }
  };

  return <div className="flex h-full min-h-0 flex-col bg-bg text-ink">
    <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3"><div><div className="font-bold">外勤任務</div><div className="text-xs text-muted">{team?.name || "外勤隊伍"} · {username}</div></div><button onClick={onLogout} className="min-h-11 px-3 text-sm text-muted">登出</button></header>
    <main className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mb-3 flex items-center justify-between"><div><h1 className="font-bold">隊伍任務</h1><p className="text-xs text-muted">只顯示指派給所屬隊伍的任務 · {missions.length} 件</p></div><button onClick={() => void refresh()} disabled={loading} className="min-h-11 px-3 text-sm text-accent disabled:opacity-50">{loading ? "更新中…" : "重新整理"}</button></div>
      {error && <div role="alert" className="mb-3 rounded-lg bg-critical-soft p-3 text-sm text-critical-text">{error}</div>}
      {loading && missions.length === 0 && <p className="py-12 text-center text-sm text-muted">正在載入隊伍任務…</p>}
      {!loading && missions.length === 0 && <div className="rounded-xl border border-line bg-surface p-6 text-center"><div className="font-semibold">目前沒有指派給隊伍的任務</div><p className="mt-2 text-sm text-muted">協調員派發任務後，任務會出現在這裡。</p></div>}
      <div className="space-y-3">{missions.map((mission) => {
        const nextStatuses = NEXT_MISSION_STATUSES[mission.status] || [];
        const noteRequired = nextStatuses.some((status) => ["任務完成", "已拒絕"].includes(status));
        return <article key={mission.id} className="rounded-xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-bold">{mission.title}</h2><p className="mt-1 text-xs text-muted">個案：{mission.case_label || "匿名受災者"} · 指派隊伍：{mission.team_name}</p></div><span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">{mission.status}</span></div>
          {mission.case_summary && <p className="mt-3 rounded-lg bg-bg p-3 text-sm">個案狀況：{mission.case_summary}</p>}
          <h3 className="mt-3 text-xs font-semibold text-muted">任務指示</h3><p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{mission.instructions}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted"><span>位置 {mission.latitude.toFixed(6)}, {mission.longitude.toFixed(6)}</span><a className="font-semibold text-accent underline" href={`https://www.google.com/maps?q=${mission.latitude},${mission.longitude}`} target="_blank" rel="noreferrer">在地圖中開啟</a></div>
          {nextStatuses.length > 0 && <div className="mt-4 space-y-2"><label className="block text-xs text-muted">{mission.status === "待隊伍確認" ? "補充回報（拒絕任務時需填寫原因）" : mission.status === "已抵達" ? "處置結果（完成任務時需填寫）" : noteRequired ? "補充說明（依選擇的進度可能需要填寫）" : "補充回報（選填）"}</label><textarea value={notes[mission.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [mission.id]: event.target.value }))} rows={2} maxLength={2000} className="w-full rounded-lg border border-line bg-bg p-3 text-sm" placeholder={mission.status === "已抵達" ? "描述現場處置結果、受災者情況與後續需求" : mission.status === "待隊伍確認" ? "若拒絕任務，請說明原因；接受任務可留白" : "補充現場進度"} />
            <div className="flex flex-wrap gap-2">{nextStatuses.map((status) => { const statusNeedsNote = ["任務完成", "已拒絕"].includes(status); return <button key={status} disabled={busyId === mission.id || (statusNeedsNote && !notes[mission.id]?.trim())} onClick={() => void updateStatus(mission, status)} className={`min-h-10 rounded-lg px-3 text-xs font-semibold disabled:opacity-50 ${status === "已拒絕" ? "border border-line text-muted" : "bg-accent text-white"}`}>{busyId === mission.id ? "更新中…" : status}</button>; })}</div>
          </div>}
          {mission.status_history?.length ? <details className="mt-4 border-t border-line pt-3"><summary className="cursor-pointer text-xs font-semibold">任務進度紀錄（{mission.status_history.length}）</summary><ul className="mt-2 space-y-2">{[...mission.status_history].reverse().map((entry, index) => <li key={`${entry.updated_at}-${index}`} className="rounded-lg bg-bg p-2 text-xs"><span>{entry.from_status} → {entry.to_status}</span><div className="mt-1 text-muted">{formatDate(entry.updated_at)}{entry.note ? ` · ${entry.note}` : ""}</div></li>)}</ul></details> : null}
        </article>;
      })}</div>
    </main>
  </div>;
}

function formatDate(value?: string) {
  if (!value) return "時間未提供";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "時間未提供" : date.toLocaleString("zh-TW", { hour12: false });
}
