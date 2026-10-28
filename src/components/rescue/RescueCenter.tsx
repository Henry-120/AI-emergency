import React, { useEffect, useMemo, useState } from "react";
import { addEventToRescueIncident, createPersonRescueCaseFromReport, createRescueIncident, createRescueMission, createRescueSiteFromReport, createRescueTeam, FieldReport, FieldSummary, fetchFieldReports, fetchFieldSummary, fetchPersonRescueCases, fetchRescueIncidents, fetchRescueMissions, fetchRescueSites, fetchRescueTeamMembers, fetchRescueTeams, linkFieldReport, PersonRescueCase, RescueIncident, RescueMission, RescueSite, RescueTeam, RescueTeamCreated, RescueTeamMember, updatePersonRescueCaseStatus, updateRescueStatus } from "../../services/rescueService";
import { RescueMapPage } from "./RescueMapPage";
import { SIMULATED_EARTHQUAKE_KEY } from "../../services/earthquakeEventKey";

type View = "map" | "reports" | "cases" | "teams" | "briefing";
type EntityDraft = { reportId: string; type: "site" | "case"; label: string; description: string; siteId: string; priority: number };
const NEXT_PERSON_CASE_STATUSES: Record<string, string[]> = {
  "待核實": ["已確認需要救援", "已確認無需救援"],
  "已確認需要救援": ["待派遣", "已確認無需救援"],
  "已確認無需救援": ["結案"],
  "待派遣": ["已確認無需救援"],
  "已派遣": ["救援中", "待派遣"],
  "救援中": ["待派遣"],
  "待確認結果": ["已協助", "救援中"],
  "已協助": ["結案"],
  "結案": [],
};

export function RescueCenter({ location, username, onLogout }: {
  location: { lat: number; lng: number } | null;
  username: string;
  onLogout: () => void;
}) {
  const [view, setView] = useState<View>("map");
  const [reports, setReports] = useState<FieldReport[]>([]);
  const [incidents, setIncidents] = useState<RescueIncident[]>([]);
  const [personCases, setPersonCases] = useState<PersonRescueCase[]>([]);
  const [missions, setMissions] = useState<RescueMission[]>([]);
  const [teams, setTeams] = useState<RescueTeam[]>([]);
  const [selectedPersonCaseId, setSelectedPersonCaseId] = useState("");
  const [sites, setSites] = useState<RescueSite[]>([]);
  const [selectedQuake, setSelectedQuake] = useState("");
  const [selectedIncidentId, setSelectedIncidentId] = useState("");
  const [incidentTitle, setIncidentTitle] = useState("");
  const [linkSelections, setLinkSelections] = useState<Record<string, string>>({});
  const [entityDraft, setEntityDraft] = useState<EntityDraft | null>(null);
  const [savingEntity, setSavingEntity] = useState(false);
  const [updatingCaseStatusId, setUpdatingCaseStatusId] = useState("");
  const [creatingMissionForCase, setCreatingMissionForCase] = useState("");
  const [summary, setSummary] = useState<FieldSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const quakes = useMemo(() => [...new Map(reports.map((report) => [report.earthquake_key, report])).values()], [reports]);
  const getEventLabel = (eventKey: string) => formatEventLabel(reports.find((report) => report.earthquake_key === eventKey));

  const loadReports = async () => {
    try {
      const [items, groups, cases, rescueSites, rescueMissions, rescueTeams] = await Promise.all([
        fetchFieldReports(), fetchRescueIncidents(), fetchPersonRescueCases(), fetchRescueSites(), fetchRescueMissions(), fetchRescueTeams(),
      ]);
      setReports(items);
      setIncidents(groups);
      setPersonCases(cases);
      setSites(rescueSites);
      setMissions(rescueMissions);
      setTeams(rescueTeams);
      setSelectedPersonCaseId((current) => cases.some((item) => item.id === current) ? current : cases[0]?.id || "");
      setSelectedQuake((current) => current || items[0]?.earthquake_key || "");
      setSelectedIncidentId((current) => current || groups[0]?.id || "");
      setError("");
    } catch (err) { setError(err instanceof Error ? err.message : "現場回報載入失敗"); }
  };

  useEffect(() => { void loadReports(); }, []);

  const makeSummary = async () => {
    if (!selectedQuake && !selectedIncidentId) return;
    setLoading(true); setError(""); setSummary(null);
    try { setSummary(await fetchFieldSummary(selectedIncidentId ? undefined : selectedQuake, selectedIncidentId || undefined)); }
    catch (err) { setError(err instanceof Error ? err.message : "AI 災情摘要產生失敗"); }
    finally { setLoading(false); }
  };

  const createIncident = async () => {
    if (!selectedQuake) return;
    const quake = quakes.find((item) => item.earthquake_key === selectedQuake);
    const eventName = quake?.earthquake_key === SIMULATED_EARTHQUAKE_KEY
      ? "模擬地震測試"
      : quake?.location || "地震事件";
    const title = incidentTitle.trim() || `應變行動 · ${eventName} M${quake?.magnitude.toFixed(1) || "?"}`;
    try {
      const created = await createRescueIncident(title, selectedQuake);
      setIncidents((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setSelectedIncidentId(created.id);
      setIncidentTitle("");
      setSummary(null);
      setError("");
    } catch (err) { setError(err instanceof Error ? err.message : "建立救援行動失敗"); }
  };

  const addSelectedQuakeToIncident = async () => {
    if (!selectedIncidentId || !selectedQuake) return;
    try {
      const updated = await addEventToRescueIncident(selectedIncidentId, selectedQuake);
      setIncidents((current) => current.map((item) => item.id === updated.id ? updated : item));
      setSummary(null);
      setError("");
    } catch (err) { setError(err instanceof Error ? err.message : "加入地震事件失敗"); }
  };

  const selectedIncident = incidents.find((item) => item.id === selectedIncidentId);

  const canRelateToEvent = (targetEventKey: string, targetIncidentId?: string, sourceEventKey?: string) => {
    if (targetEventKey === sourceEventKey) return true;
    return Boolean(targetIncidentId && incidents.some((incident) =>
      incident.id === targetIncidentId
      && incident.event_keys.includes(targetEventKey)
      && incident.event_keys.includes(sourceEventKey || ""),
    ));
  };

  const openEntityDraft = (report: FieldReport, type: "site" | "case") => {
    setEntityDraft({
      reportId: report.id,
      type,
      label: type === "site" ? "待查證現場" : "匿名受災者",
      description: type === "site" ? report.observation : "",
      siteId: "",
      priority: 3,
    });
  };

  const submitEntityDraft = async (report: FieldReport) => {
    if (!entityDraft || entityDraft.reportId !== report.id || !entityDraft.label.trim()) return;
    setSavingEntity(true);
    try {
      const incidentId = selectedIncident?.event_keys.includes(report.earthquake_key)
        ? selectedIncident.id
        : undefined;
      if (entityDraft.type === "site") {
        await createRescueSiteFromReport(report.id, {
          title: entityDraft.label.trim(),
          description: entityDraft.description,
          incident_id: incidentId,
        });
      } else {
        const createdCase = await createPersonRescueCaseFromReport(report.id, {
          label: entityDraft.label.trim(),
          situation_summary: entityDraft.description,
          priority: entityDraft.priority,
          site_id: entityDraft.siteId || undefined,
          incident_id: incidentId,
        });
        setSelectedPersonCaseId(createdCase.id);
        setView("cases");
      }
      setEntityDraft(null);
      await loadReports();
    } catch (err) { setError(err instanceof Error ? err.message : "建立資料失敗"); }
    finally { setSavingEntity(false); }
  };

  const linkSelectedEntity = async (report: FieldReport) => {
    const selection = linkSelections[report.id];
    if (!selection) return;
    const [type, ...idParts] = selection.split(":");
    const targetId = idParts.join(":");
    if ((type !== "site" && type !== "case") || !targetId) return;
    try {
      await linkFieldReport(report.id, type, targetId);
      setLinkSelections((current) => ({ ...current, [report.id]: "" }));
      await loadReports();
    } catch (err) { setError(err instanceof Error ? err.message : "連結來源失敗"); }
  };

  const changeStatus = async (report: FieldReport, status: string) => {
    try {
      await updateRescueStatus("field-reports", report.id, status);
      setReports((current) => current.map((item) => item.id === report.id ? { ...item, status } : item));
    } catch (err) { setError(err instanceof Error ? err.message : "狀態更新失敗"); }
  };

  const changePersonCaseStatus = async (caseId: string, status: string) => {
    setUpdatingCaseStatusId(caseId);
    setError("");
    try {
      const updated = await updatePersonRescueCaseStatus(caseId, status);
      setPersonCases((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (err) { setError(err instanceof Error ? err.message : "個人案件狀態更新失敗"); }
    finally { setUpdatingCaseStatusId(""); }
  };

  const createMissionForCase = async (caseId: string, data: { title: string; team_id: string; instructions: string }) => {
    setCreatingMissionForCase(caseId);
    setError("");
    try {
      const created = await createRescueMission({ case_id: caseId, ...data });
      setMissions((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setPersonCases((current) => current.map((item) => item.id === caseId ? {
        ...item,
        status: "已派遣",
        status_history: [...(item.status_history || []), {
          from_status: "待派遣",
          to_status: "已派遣",
          updated_by: created.created_by,
          updated_at: created.assigned_at,
          reason: "建立救援派遣任務",
          mission_id: created.id,
        }],
      } : item));
      await loadReports();
    } catch (err) { setError(err instanceof Error ? err.message : "建立救援任務失敗"); }
    finally { setCreatingMissionForCase(""); }
  };

  const handleCreateTeam = async (name: string): Promise<RescueTeamCreated | null> => {
    setError("");
    try {
      const created = await createRescueTeam(name);
      setTeams((current) => [...current, { id: created.id, name: created.name, created_by: created.created_by, created_at: created.created_at, member_count: 0 }]);
      return created;
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立救援隊伍失敗");
      return null;
    }
  };

  return <div className="flex h-full min-h-0 flex-col bg-bg text-ink safe-area-top safe-area-bottom">
    <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
      <div><div className="font-bold">救援工作台</div><div className="text-xs text-muted">救援人員・{username}</div></div>
      <button onClick={onLogout} className="tappable min-h-11 px-3 text-sm text-muted">登出</button>
    </header>
    <nav className="grid shrink-0 grid-cols-5 border-b border-line bg-surface">
      {([ ["map", "任務地圖"], ["reports", "現場回報"], ["cases", "個人案件"], ["teams", "隊伍名冊"], ["briefing", "災情彙整"] ] as const).map(([key, label]) =>
        <button key={key} onClick={() => setView(key)} className={`min-h-12 border-b-2 text-sm font-semibold ${view === key ? "border-accent text-accent" : "border-transparent text-muted"}`}>{label}</button>)}
    </nav>
    {error && <div role="alert" className="shrink-0 bg-critical-soft px-4 py-2 text-sm text-critical-text">{error}</div>}
    <main className="min-h-0 flex-1">
      {view === "map" && <RescueMapPage location={location} />}
      {view === "cases" && <PersonCasesWorkspace cases={personCases} sites={sites} reports={reports} missions={missions} teams={teams} selectedId={selectedPersonCaseId} onSelect={setSelectedPersonCaseId} onRefresh={() => void loadReports()} onChangeStatus={(caseId, status) => void changePersonCaseStatus(caseId, status)} onCreateMission={createMissionForCase} updatingStatusId={updatingCaseStatusId} creatingMissionForCase={creatingMissionForCase} />}
      {view === "teams" && <RescueTeamWorkspace teams={teams} onCreateTeam={handleCreateTeam} onRefresh={() => void loadReports()} />}
      {view === "reports" && <section className="h-full overflow-y-auto p-3">
        <div className="mb-3 flex items-center justify-between"><div><h1 className="font-bold">第一手現場回報</h1><p className="text-xs text-muted">依回報時間排序 · {reports.length} 筆</p></div><button onClick={() => void loadReports()} className="min-h-11 px-3 text-sm text-accent">重新整理</button></div>
        {reports.length === 0 && <p className="py-12 text-center text-sm text-muted">目前沒有地震現場回報</p>}
        <div className="space-y-3">{reports.map((report) => <article key={report.id} className="rounded-xl border border-line bg-surface p-3">
          <div className="flex items-start justify-between gap-2"><div><div className="font-semibold">{formatEventLabel(report)}</div><div className="mt-1 text-xs text-muted">回報時間 {formatDate(report.observed_at || report.server_timestamp)} · 距震央 {report.distance_km.toFixed(1)} 公里</div></div><StatusSelect value={report.status} options={["待確認", "已確認", "已處理"]} onChange={(status) => void changeStatus(report, status)} /></div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{report.observation}</p>
          <div className="mt-2 text-xs text-muted">位置 {report.user_latitude.toFixed(4)}, {report.user_longitude.toFixed(4)}</div>
          <details className="mt-3 border-t border-line pt-3">
            <summary className="cursor-pointer text-sm font-semibold">現場／個人案件連結{report.links?.length ? ` · 已連結 ${report.links.length} 項` : " · 尚未連結"}</summary>
            {report.links && report.links.length > 0 && <ul className="mt-2 space-y-1 text-xs text-muted">{report.links.map((link) => <li key={link.id}>• {link.target_type === "site" ? "現場" : "個人案件"}：{link.target_label} · {link.note}</li>)}</ul>}
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
              <select value={linkSelections[report.id] || ""} onChange={(event) => setLinkSelections((current) => ({ ...current, [report.id]: event.target.value }))} className="min-h-10 rounded-lg border border-line bg-bg px-2 text-xs">
                <option value="">選擇同事件／同救援行動的既有現場或個人案件</option>
                {sites.filter((site) => canRelateToEvent(site.earthquake_key, site.incident_id, report.earthquake_key)).map((site) => <option key={`site:${site.id}`} value={`site:${site.id}`}>現場 · {site.title}</option>)}
                {personCases.filter((item) => canRelateToEvent(item.earthquake_key, item.incident_id, report.earthquake_key)).map((item) => <option key={`case:${item.id}`} value={`case:${item.id}`}>個人案件 · {item.label}（{item.status}）</option>)}
              </select>
              <button disabled={!linkSelections[report.id]} onClick={() => void linkSelectedEntity(report)} className="min-h-10 rounded-lg border border-line px-3 text-xs font-semibold disabled:opacity-50">連結來源</button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => openEntityDraft(report, "site")} className="min-h-10 rounded-lg bg-accent-soft px-3 text-xs font-semibold text-accent">由此回報建立現場</button>
              <button onClick={() => openEntityDraft(report, "case")} className="min-h-10 rounded-lg bg-accent-soft px-3 text-xs font-semibold text-accent">由此回報建立一名個人案件</button>
            </div>
            {entityDraft?.reportId === report.id && <div className="mt-3 space-y-2 rounded-lg bg-bg p-3">
              <div className="text-xs font-semibold">{entityDraft.type === "site" ? "建立救援現場" : "建立個人救援案件（初始狀態：待核實）"}</div>
              <label className="block text-xs text-muted">{entityDraft.type === "site" ? "現場名稱" : "個案標示（可用匿名代稱）"}</label>
              <input value={entityDraft.label} onChange={(event) => setEntityDraft((current) => current ? { ...current, label: event.target.value } : current)} className="min-h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm" />
              <label className="block text-xs text-muted">{entityDraft.type === "site" ? "現場描述" : "此人的情況摘要"}</label>
              <textarea value={entityDraft.description} onChange={(event) => setEntityDraft((current) => current ? { ...current, description: event.target.value } : current)} placeholder={entityDraft.type === "case" ? "只填這一名受災者的資訊；多人描述請分別建案" : "描述此地點的情況"} rows={3} className="w-full rounded-lg border border-line bg-surface p-3 text-sm" />
              {entityDraft.type === "case" && <>
                <label className="block text-xs text-muted">連結到既有現場（可略過）</label>
                <select value={entityDraft.siteId} onChange={(event) => setEntityDraft((current) => current ? { ...current, siteId: event.target.value } : current)} className="min-h-10 w-full rounded-lg border border-line bg-surface px-2 text-sm">
                  <option value="">不指定現場</option>
                  {sites.filter((site) => canRelateToEvent(site.earthquake_key, site.incident_id, report.earthquake_key)).map((site) => <option key={site.id} value={site.id}>{site.title}</option>)}
                </select>
                <label className="block text-xs text-muted">優先級（1 低、5 高）</label>
                <select value={entityDraft.priority} onChange={(event) => setEntityDraft((current) => current ? { ...current, priority: Number(event.target.value) } : current)} className="min-h-10 rounded-lg border border-line bg-surface px-2 text-sm">{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select>
              </>}
              <div className="flex gap-2"><button disabled={!entityDraft.label.trim() || savingEntity} onClick={() => void submitEntityDraft(report)} className="min-h-10 rounded-lg bg-accent px-4 text-xs font-bold text-white disabled:opacity-50">{savingEntity ? "儲存中…" : "建立並連結此回報"}</button><button onClick={() => setEntityDraft(null)} className="min-h-10 rounded-lg border border-line px-4 text-xs">取消</button></div>
              {entityDraft.type === "case" && <p className="text-xs text-muted">只有在你確認此回報可建立一名個人案件時才建立；若內容描述多人，請分別建立每人的案件，案件會保留待核實狀態。</p>}
            </div>}
          </details>
        </article>)}</div>
      </section>}
      {view === "briefing" && <section className="h-full overflow-y-auto p-4">
        <h1 className="font-bold">AI 災情彙整</h1><p className="mt-1 text-sm text-muted">可將主震與經確認相關的餘震加入同一救援行動，彙整其第一手回報；地震事件本身仍各自保留。</p>
        <label className="mt-5 block text-xs font-semibold text-muted">選擇地震事件</label>
        <select value={selectedQuake} onChange={(event) => { setSelectedQuake(event.target.value); setSummary(null); }} className="mt-2 min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink">
          {quakes.length === 0 && <option value="">目前沒有可加入的地震回報</option>}
          {quakes.map((item) => <option key={item.earthquake_key} value={item.earthquake_key}>{formatEventLabel(item)} · {reports.filter((r) => r.earthquake_key === item.earthquake_key).length} 筆回報</option>)}
        </select>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <input value={incidentTitle} onChange={(event) => setIncidentTitle(event.target.value)} placeholder="救援行動名稱（可留白自動命名）" className="min-h-11 rounded-xl border border-line bg-surface px-3 text-sm" />
          <button disabled={!selectedQuake} onClick={() => void createIncident()} className="min-h-11 rounded-xl border border-line px-4 text-sm font-semibold disabled:opacity-50">以此地震建立救援行動</button>
        </div>
        <label className="mt-5 block text-xs font-semibold text-muted">救援行動群組</label>
        <select value={selectedIncidentId} onChange={(event) => { setSelectedIncidentId(event.target.value); setSummary(null); }} className="mt-2 min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink">
          <option value="">不套用救援行動（只看單一地震）</option>
          {incidents.map((incident) => <option key={incident.id} value={incident.id}>{incident.title} · {incident.event_keys.length} 個地震事件</option>)}
        </select>
        {selectedIncident && <div className="mt-3 rounded-xl border border-line bg-surface p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-sm font-semibold">行動涵蓋 {selectedIncident.event_keys.length} 個地震事件</div><button onClick={() => void addSelectedQuakeToIncident()} disabled={!selectedQuake} className="min-h-10 rounded-lg bg-accent-soft px-3 text-xs font-semibold text-accent disabled:opacity-50">加入目前選定地震</button></div>
          <ul className="mt-2 space-y-1 text-xs text-muted">{selectedIncident.event_keys.map((key) => {
            const eventReport = quakes.find((item) => item.earthquake_key === key);
            return <li key={key}>• {formatEventLabel(eventReport)} · {reports.filter((report) => report.earthquake_key === key).length} 筆回報</li>;
          })}</ul>
          <p className="mt-2 text-xs text-muted">加入行動只會將不同地震事件的回報一起檢視與摘要，不會把事件或原始回報合併刪除。</p>
        </div>}
        <button disabled={(!selectedQuake && !selectedIncidentId) || loading} onClick={() => void makeSummary()} className="mt-3 min-h-12 w-full rounded-xl bg-accent px-4 font-bold text-white disabled:opacity-50">{loading ? "正在整理回報…" : selectedIncidentId ? "產生整個救援行動的 AI 災情摘要" : "產生單一地震的 AI 災情摘要"}</button>
        {summary && <article className="mt-5 rounded-xl border border-line bg-surface p-4">
          <div className="flex justify-between gap-3"><h2 className="font-bold">現場資訊摘要草稿</h2><span className="text-xs text-muted">{summary.report_count} 筆來源</span></div>
          <p className="mt-3 text-sm leading-relaxed">{summary.summary}</p>
          {summary.key_findings.length > 0 && <><h3 className="mt-5 text-sm font-bold">回報重點</h3><ul className="mt-2 list-disc space-y-2 pl-5 text-sm">{summary.key_findings.map((item, i) => <li key={i}>{item}</li>)}</ul></>}
          {summary.uncertainties.length > 0 && <><h3 className="mt-5 text-sm font-bold">待查證</h3><ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-muted">{summary.uncertainties.map((item, i) => <li key={i}>{item}</li>)}</ul></>}
          <details className="mt-5 border-t border-line pt-3"><summary className="cursor-pointer text-sm font-semibold">來源回報（{summary.source_ids.length} 筆，可對照 AI 提及的回報編號）</summary><ul className="mt-2 space-y-2 text-xs text-muted">{summary.source_refs.map((source) => <li key={source.id}>回報 {source.number} · {source.location} · {formatDate(source.observed_at)} · 編號 {source.id}</li>)}</ul></details>
          <p className="mt-3 text-xs text-muted">產生於 {formatDate(summary.generated_at)} · AI 摘要草稿，請回到原始回報核對</p>
        </article>}
      </section>}
    </main>
  </div>;
}

function PersonCasesWorkspace({ cases, sites, reports, missions, teams, selectedId, onSelect, onRefresh, onChangeStatus, onCreateMission, updatingStatusId, creatingMissionForCase }: {
  cases: PersonRescueCase[];
  sites: RescueSite[];
  reports: FieldReport[];
  missions: RescueMission[];
  teams: RescueTeam[];
  selectedId: string;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onChangeStatus: (caseId: string, status: string) => void;
  onCreateMission: (caseId: string, data: { title: string; team_id: string; instructions: string }) => void;
  updatingStatusId: string;
  creatingMissionForCase: string;
}) {
  const selected = cases.find((item) => item.id === selectedId);
  const sourceReports = selected ? reports.filter((report) => report.links?.some((link) => link.target_type === "case" && link.target_id === selected.id)) : [];
  const relatedSites = selected ? sites.filter((site) => site.id === selected.site_id || sourceReports.some((report) => report.links?.some((link) => link.target_type === "site" && link.target_id === site.id))) : [];
  const selectedMissions = selected ? missions.filter((mission) => mission.case_id === selected.id) : [];

  return <section className="h-full overflow-y-auto p-3">
    <div className="mb-3 flex items-center justify-between"><div><h1 className="font-bold">個人救援案件</h1><p className="text-xs text-muted">集中檢視每名受災者的案件摘要、位置與來源 · {cases.length} 件</p></div><button onClick={onRefresh} className="min-h-11 px-3 text-sm text-accent">重新整理</button></div>
    {cases.length === 0 ? <div className="rounded-xl border border-line bg-surface p-6 text-center"><p className="font-semibold">目前沒有個人案件</p><p className="mt-2 text-sm text-muted">到「現場回報」選擇一筆回報，按「由此回報建立一名個人案件」。</p></div> : <div className="grid gap-3 md:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.6fr)]">
      <div className="space-y-2">{cases.map((item) => <button key={item.id} onClick={() => onSelect(item.id)} className={`w-full rounded-xl border p-3 text-left ${item.id === selectedId ? "border-accent bg-accent-soft" : "border-line bg-surface"}`}>
        <div className="flex items-start justify-between gap-2"><span className="font-semibold">{item.label}</span><span className="shrink-0 rounded-full bg-bg px-2 py-1 text-xs">{item.status}</span></div>
        <div className="mt-2 text-xs text-muted">優先級 {item.priority}/5 · {item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}</div>
        <p className="mt-2 line-clamp-2 text-sm text-muted">{item.situation_summary || "尚未填寫個案摘要"}</p>
      </button>)}</div>
      {selected && <article className="rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="text-lg font-bold">{selected.label}</h2><p className="mt-1 text-xs text-muted">個人案件 · {selected.id}</p></div><span className="rounded-full bg-accent-soft px-3 py-1 text-sm font-semibold text-accent">{selected.status}</span></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <InfoField label="優先級" value={`${selected.priority} / 5`} />
          <InfoField label="地理位置" value={`${selected.latitude.toFixed(6)}, ${selected.longitude.toFixed(6)}`} />
          <InfoField label="地震事件" value={formatEventLabel(reports.find((report) => report.earthquake_key === selected.earthquake_key))} />
          <InfoField label="所屬現場" value={relatedSites.length ? relatedSites.map((site) => site.title).join("、") : "尚未連結現場"} />
        </div>
        <h3 className="mt-5 text-sm font-bold">個案情況摘要</h3><p className="mt-2 whitespace-pre-wrap rounded-lg bg-bg p-3 text-sm leading-relaxed">{selected.situation_summary || "尚未填寫個案摘要。可回到來源回報查看原始描述。"}</p>
        <section className="mt-5 rounded-xl border border-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold">案件處理流程</h3><span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">目前：{selected.status}</span></div>
          <p className="mt-2 text-xs text-muted">依序核實、確認救援需求、登記派遣與處理結果。狀態更新會記錄操作者與時間。</p>
          {selected.status === "待確認結果" && <section className="mt-3 rounded-lg border border-accent/40 bg-accent-soft p-3"><h4 className="text-sm font-bold">隊伍處置結果待核實</h4><p className="mt-1 text-xs text-muted">請先核對以下隊伍回報，再決定是否標記「已協助」或退回「救援中」。</p>
            {selectedMissions.filter((mission) => mission.status === "任務完成").length ? <ul className="mt-2 space-y-2">{selectedMissions.filter((mission) => mission.status === "任務完成").map((mission) => {
              const completion = [...(mission.status_history || [])].reverse().find((entry) => entry.to_status === "任務完成");
              return <li key={mission.id} className="rounded-lg bg-surface p-3"><div className="flex flex-wrap justify-between gap-2 text-xs"><span className="font-semibold">{mission.team_name} · {mission.title}</span><span className="text-muted">回報時間：{formatDate(completion?.updated_at)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm">{completion?.note?.trim() || "隊伍完成任務時沒有附加文字回報。"}</p></li>;
            })}</ul> : <p className="mt-2 text-sm">尚未載入任務完成回報，請按頁面上方「重新整理」後再核對。</p>}
          </section>}
          {NEXT_PERSON_CASE_STATUSES[selected.status]?.length ? <div className="mt-3 flex flex-wrap gap-2">{NEXT_PERSON_CASE_STATUSES[selected.status].map((status) => <button key={status} disabled={updatingStatusId === selected.id} onClick={() => onChangeStatus(selected.id, status)} className={`min-h-10 rounded-lg px-3 text-xs font-semibold disabled:opacity-50 ${status === "已確認無需救援" ? "border border-line text-muted" : "bg-accent px-3 text-white"}`}>{updatingStatusId === selected.id ? "更新中…" : `改為「${status}」`}</button>)}</div> : <p className="mt-3 text-sm text-muted">此案件已結案，沒有可用的下一狀態。</p>}
          <p className="mt-3 text-xs text-muted">案件進入「待派遣」後，建立任務會同步將案件推進到「已派遣」。</p>
        </section>
        <section className="mt-5">
          <h3 className="text-sm font-bold">救援任務（{selectedMissions.length}）</h3>
          {selectedMissions.length > 0 && <ul className="mt-2 space-y-2">{selectedMissions.map((mission) => <li key={mission.id} className="rounded-lg border border-line bg-bg p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div className="font-semibold">{mission.title}</div><span className="rounded-full bg-accent-soft px-2 py-1 text-xs text-accent">{mission.status}</span></div><div className="mt-1 text-xs text-muted">受派隊伍：{mission.team_name} · 建立於 {formatDate(mission.assigned_at)}</div><p className="mt-2 whitespace-pre-wrap text-sm">{mission.instructions}</p>
            <div className="mt-3 border-t border-line pt-3"><h4 className="text-xs font-bold">隊伍進度與補充回報（{mission.status_history?.length || 0} 筆）</h4>
              {mission.status_history?.length ? <ol className="mt-2 space-y-2">{[...mission.status_history].reverse().map((entry, index) => <li key={`${entry.updated_at}-${index}`} className="rounded-lg border border-line bg-surface p-3"><div className="flex flex-wrap justify-between gap-2"><span className="text-sm font-semibold">{entry.from_status || "任務建立"} → {entry.to_status}</span><span className="text-xs text-muted">{formatDate(entry.updated_at)}</span></div><p className="mt-1 whitespace-pre-wrap text-sm">{entry.note?.trim() || "此階段未附加文字回報。"}</p></li>)}</ol> : <p className="mt-2 text-xs text-muted">隊伍尚未更新任務進度。</p>}
            </div></li>)}</ul>}
          {selected.status === "待派遣" && teams.length > 0 && <MissionDispatchForm key={selected.id} caseItem={selected} teams={teams} busy={creatingMissionForCase === selected.id} onSubmit={(data) => onCreateMission(selected.id, data)} />}
          {selected.status === "待派遣" && teams.length === 0 && <p className="mt-2 text-sm text-muted">請先到「隊伍名冊」建立救援隊伍，再返回此處建立派遣任務。</p>}
          {selected.status !== "待派遣" && selectedMissions.length === 0 && <p className="mt-2 text-sm text-muted">案件進入「待派遣」後，可在此建立任務並登記受派隊伍。</p>}
          <p className="mt-2 text-xs text-muted">受派隊伍會從「隊伍名冊」選取；任務建立後會出現在該隊外勤帳號，外勤人員可回報接受、前往現場、抵達與任務結果。</p>
        </section>
        <h3 className="mt-5 text-sm font-bold">狀態操作紀錄（{selected.status_history?.length || 0}）</h3>
        {selected.status_history?.length ? <ol className="mt-2 space-y-2">{[...selected.status_history].reverse().map((entry, index) => <li key={`${entry.updated_at}-${index}`} className="rounded-lg bg-bg p-3 text-sm"><span className="font-medium">{entry.from_status || "新建"} → {entry.to_status}</span><div className="mt-1 text-xs text-muted">{formatDate(entry.updated_at)} · {entry.mission_id ? "外勤隊伍回報（任務狀態同步）" : "協調中心操作"}{entry.reason ? ` · ${entry.reason}` : ""}</div></li>)}</ol> : <p className="mt-2 text-sm text-muted">尚無狀態變更紀錄；新建案件的初始狀態為「待核實」。</p>}
        <h3 className="mt-5 text-sm font-bold">來源回報（{sourceReports.length}）</h3>
        {sourceReports.length ? <ul className="mt-2 space-y-2">{sourceReports.map((report) => <li key={report.id} className="rounded-lg bg-bg p-3"><div className="text-xs text-muted">{formatDate(report.observed_at || report.server_timestamp)} · {report.location}</div><p className="mt-1 whitespace-pre-wrap text-sm">{report.observation}</p><div className="mt-1 text-xs text-muted">回報位置 {report.user_latitude.toFixed(6)}, {report.user_longitude.toFixed(6)}</div></li>)}</ul> : <p className="mt-2 text-sm text-muted">目前沒有透過來源關聯找到回報。可到「現場回報」將相關回報連結到此案件。</p>}
        <p className="mt-4 rounded-lg border border-line p-3 text-xs text-muted">案件狀態與操作紀錄會儲存至後端；目前狀態記錄不會自動改變來源回報狀態。</p>
      </article>}
    </div>}
  </section>;
}

function MissionDispatchForm({ caseItem, teams, busy, onSubmit }: {
  caseItem: PersonRescueCase;
  teams: RescueTeam[];
  busy: boolean;
  onSubmit: (data: { title: string; team_id: string; instructions: string }) => void;
}) {
  const [title, setTitle] = useState(`個人救援 · ${caseItem.label}`);
  const [teamId, setTeamId] = useState(teams[0]?.id || "");
  const [instructions, setInstructions] = useState(caseItem.situation_summary);
  useEffect(() => { if (!teamId && teams.length) setTeamId(teams[0].id); }, [teamId, teams]);
  const isValid = Boolean(title.trim() && teamId && instructions.trim());
  return <form onSubmit={(event) => { event.preventDefault(); if (isValid) onSubmit({ title: title.trim(), team_id: teamId, instructions: instructions.trim() }); }} className="mt-3 space-y-2 rounded-xl border border-line bg-surface p-3">
    <div className="text-sm font-semibold">建立派遣任務</div>
    <label className="block text-xs text-muted">任務名稱</label>
    <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} className="min-h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm" />
    <label className="block text-xs text-muted">受派救援隊伍</label>
    <select value={teamId} onChange={(event) => setTeamId(event.target.value)} className="min-h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm">{teams.map((team) => <option key={team.id} value={team.id}>{team.name} · {team.member_count} 名外勤隊員</option>)}</select>
    <label className="block text-xs text-muted">任務指示</label>
    <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={4000} rows={3} placeholder="說明救援需求、地點或抵達後優先確認事項" className="w-full rounded-lg border border-line bg-bg p-3 text-sm" />
    <button type="submit" disabled={!isValid || busy} className="min-h-10 rounded-lg bg-accent px-4 text-xs font-bold text-white disabled:opacity-50">{busy ? "建立中…" : "建立任務並登記派遣"}</button>
  </form>;
}

function RescueTeamWorkspace({ teams, onCreateTeam, onRefresh }: {
  teams: RescueTeam[];
  onCreateTeam: (name: string) => Promise<RescueTeamCreated | null>;
  onRefresh: () => void;
}) {
  const [teamName, setTeamName] = useState("");
  const [createdTeam, setCreatedTeam] = useState<RescueTeamCreated | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [members, setMembers] = useState<RescueTeamMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [copyLabel, setCopyLabel] = useState("複製邀請碼");
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!teamName.trim()) return;
    setError("");
    const team = await onCreateTeam(teamName.trim());
    if (team) {
      setCreatedTeam(team);
      setTeamName("");
      setSelectedTeamId(team.id);
      setMembers([]);
    }
  };

  const selectTeam = async (teamId: string) => {
    setSelectedTeamId(teamId);
    setLoadingMembers(true);
    setError("");
    try { setMembers(await fetchRescueTeamMembers(teamId)); }
    catch (err) { setError(err instanceof Error ? err.message : "隊員資料載入失敗"); }
    finally { setLoadingMembers(false); }
  };

  const copyInviteCode = async () => {
    if (!createdTeam) return;
    try {
      await navigator.clipboard.writeText(createdTeam.join_code);
      setCopyLabel("已複製");
      window.setTimeout(() => setCopyLabel("複製邀請碼"), 1800);
    } catch { setCopyLabel("請手動選取複製"); }
  };

  const selectedTeam = teams.find((team) => team.id === selectedTeamId);
  return <section className="h-full overflow-y-auto p-4">
    <div className="mb-4 flex items-center justify-between gap-2"><div><h1 className="font-bold">救援隊伍名冊</h1><p className="mt-1 text-sm text-muted">建立隊伍後，將邀請碼交給該隊外勤人員註冊加入。</p></div><button onClick={onRefresh} className="min-h-11 px-3 text-sm text-accent">重新整理</button></div>
    {error && <p role="alert" className="mb-3 rounded-lg bg-critical-soft p-3 text-sm text-critical-text">{error}</p>}
    <form onSubmit={(event) => void submit(event)} className="rounded-xl border border-line bg-surface p-4">
      <label className="block text-xs font-semibold text-muted">新隊伍名稱</label>
      <div className="mt-2 flex gap-2"><input value={teamName} onChange={(event) => setTeamName(event.target.value)} minLength={2} maxLength={120} placeholder="例如：北區搜救一隊" className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-sm" /><button disabled={teamName.trim().length < 2} className="min-h-11 rounded-lg bg-accent px-4 text-sm font-bold text-white disabled:opacity-50">建立隊伍</button></div>
    </form>
    {createdTeam && <div className="mt-3 rounded-xl border border-accent bg-accent-soft p-4"><div className="font-semibold">{createdTeam.name} 已建立</div><p className="mt-1 text-sm">請將以下邀請碼交給這支隊伍的外勤人員。邀請碼只在建立時顯示，請先保存。</p><div className="mt-3 flex flex-wrap items-center gap-2"><code className="rounded-lg bg-surface px-3 py-2 text-lg font-bold tracking-widest">{createdTeam.join_code}</code><button onClick={() => void copyInviteCode()} className="min-h-10 rounded-lg border border-line bg-surface px-3 text-xs font-semibold">{copyLabel}</button></div></div>}
    <h2 className="mt-5 font-bold">已建立隊伍（{teams.length}）</h2>
    {teams.length === 0 ? <p className="mt-2 text-sm text-muted">目前沒有隊伍。建立隊伍後即可使用正式的隊伍選單派遣任務。</p> : <div className="mt-2 grid gap-3 md:grid-cols-2">
      <div className="space-y-2">{teams.map((team) => <button key={team.id} onClick={() => void selectTeam(team.id)} className={`w-full rounded-xl border p-3 text-left ${team.id === selectedTeamId ? "border-accent bg-accent-soft" : "border-line bg-surface"}`}><div className="font-semibold">{team.name}</div><div className="mt-1 text-xs text-muted">外勤隊員 {team.member_count} 人</div></button>)}</div>
      {selectedTeam && <div className="rounded-xl border border-line bg-surface p-4"><h3 className="font-semibold">{selectedTeam.name} · 隊員</h3>{loadingMembers ? <p className="mt-3 text-sm text-muted">載入中…</p> : members.length ? <ul className="mt-3 space-y-2">{members.map((member) => <li key={member.id} className="rounded-lg bg-bg p-3"><div className="text-sm font-semibold">{member.username}</div><div className="mt-1 text-xs text-muted">{member.email || "未提供 Email"} · 加入 {formatDate(member.created_at)}</div></li>)}</ul> : <p className="mt-3 text-sm text-muted">目前還沒有隊員使用邀請碼加入。</p>}</div>}
    </div>}
  </section>;
}

function InfoField({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-bg p-3"><div className="text-xs text-muted">{label}</div><div className="mt-1 break-all text-sm font-medium">{value}</div></div>;
}

function formatEventLabel(report?: FieldReport) {
  if (!report) return "地震事件資料待取得";
  const eventTime = report.origin_time || report.observed_at || report.server_timestamp;
  const timeLabel = eventTime ? ` · ${formatDate(eventTime)}` : "";
  if (report.earthquake_key === SIMULATED_EARTHQUAKE_KEY) {
    const epicenter = report.epicenter_latitude != null && report.epicenter_longitude != null
      ? ` · 測試震央 ${report.epicenter_latitude.toFixed(3)}, ${report.epicenter_longitude.toFixed(3)}`
      : "";
    return `模擬地震（測試資料） · 規模 ${report.magnitude.toFixed(1)}${timeLabel}${epicenter}`;
  }
  return `${report.location || "地點待確認"} · 規模 ${report.magnitude.toFixed(1)}${timeLabel}`;
}

function StatusSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  return <select aria-label="案件處理狀態" value={value} onChange={(event) => onChange(event.target.value)} className="min-h-10 max-w-32 rounded-lg border border-line bg-bg px-2 text-xs">
    {!options.includes(value) && <option>{value}</option>}{options.map((option) => <option key={option}>{option}</option>)}
  </select>;
}

function formatDate(value?: string) {
  if (!value) return "時間未提供";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "時間未提供" : date.toLocaleString("zh-TW", { hour12: false });
}
