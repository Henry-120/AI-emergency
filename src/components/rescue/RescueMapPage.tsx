import React, { useEffect, useRef, useState } from "react";
import maplibregl, { Map, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { fetchNearbyPersonRescueCases, fetchNearbyRescueCases, fetchNearbySosReports, PersonRescueCase, RescueCase, SosCase, updateRescueStatus } from "../../services/rescueService";

const RESCUE_REFRESH_INTERVAL_MS = 10_000;
const RESCUE_RADIUS_KM = 50;

export function RescueMapPage({
  location,
  onBack,
}: {
  location: { lat: number; lng: number } | null;
  onBack?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const userMarkerRef = useRef<Marker | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const sosMarkersRef = useRef<Marker[]>([]);
  const personCaseMarkersRef = useRef<Marker[]>([]);
  const locationRef = useRef(location);
  const refreshInFlightRef = useRef(false);
  const initialLoadStartedRef = useRef(false);
  const [mapLocation, setMapLocation] = useState(location);
  const [cases, setCases] = useState<RescueCase[]>([]);
  const [sosCases, setSosCases] = useState<SosCase[]>([]);
  const [personCases, setPersonCases] = useState<PersonRescueCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    const currentLocation = locationRef.current;
    if (!currentLocation) {
      setError("尚未取得救難隊位置，請允許定位權限");
      return;
    }
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setLoading(true);
    setError("");
    // 各資料來源獨立擷取：其中一種載入失敗不該連帶讓其他圖層消失。
    const [rescueResult, sosResult, personCaseResult] = await Promise.allSettled([
      fetchNearbyRescueCases(currentLocation),
      fetchNearbySosReports(currentLocation),
      fetchNearbyPersonRescueCases(currentLocation, RESCUE_RADIUS_KM),
    ]);
    if (rescueResult.status === "fulfilled") setCases(rescueResult.value);
    if (sosResult.status === "fulfilled") setSosCases(sosResult.value);
    if (personCaseResult.status === "fulfilled") setPersonCases(personCaseResult.value);
    if (personCaseResult.status === "rejected") {
      setError(personCaseResult.reason instanceof Error ? `個人案件載入失敗：${personCaseResult.reason.message}` : "個人案件載入失敗");
    } else if (rescueResult.status === "rejected" && sosResult.status === "rejected") {
      setError(rescueResult.reason instanceof Error ? rescueResult.reason.message : "救援案件載入失敗");
    } else {
      setError("");
    }
    refreshInFlightRef.current = false;
    setLoading(false);
  };

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  // Load once when the page first receives a location. Later GPS updates should
  // not repeatedly fetch cases; the header button is the only subsequent refresh.
  useEffect(() => {
    if (!location || initialLoadStartedRef.current) return;
    initialLoadStartedRef.current = true;
    setMapLocation((current) => current ?? location);
    void refresh();
  }, [location]);

  // Refresh rescue coordinates without rebuilding the MapLibre map. Updating
  // `cases` only replaces the lightweight rescue markers below.
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (locationRef.current) void refresh();
    }, RESCUE_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!containerRef.current || !mapLocation || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [mapLocation.lng, mapLocation.lat],
      zoom: 12,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    userMarkerRef.current = new maplibregl.Marker({ color: "#22c55e" })
      .setLngLat([mapLocation.lng, mapLocation.lat])
      .setPopup(new maplibregl.Popup().setText("救難隊目前位置"))
      .addTo(map);
    mapRef.current = map;
    return () => {
      userMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [mapLocation]);

  // Keep only the user's marker live. This does not rebuild the map or fetch
  // rescue cases, so frequent GPS updates remain inexpensive.
  useEffect(() => {
    if (!location) return;
    userMarkerRef.current?.setLngLat([location.lng, location.lat]);
  }, [location?.lat, location?.lng]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = cases.map((item) => {
      const color = item.urgencyLevel >= 9 ? "#ef4444" : item.urgencyLevel >= 7 ? "#f97316" : "#eab308";
      return new maplibregl.Marker({ color })
        .setLngLat([item.longitude, item.latitude])
        .setPopup(new maplibregl.Popup({ offset: 24 }).setHTML(
          `<strong>${escapeHtml(item.username)}</strong><br/>緊急度 ${item.urgencyLevel}/10<br/>${escapeHtml(item.injurySummary || item.rescueNeeds.join("、") || "需要救援")}`,
        ))
        .addTo(map);
    });
  }, [cases]);

  // 藍牙中繼的求救：用不同的圖示（方形 DOM marker）跟 AI 評估案件的圓形 pin 區分開，
  // 一眼就能看出「這筆是透過藍牙中繼送達的」。
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    sosMarkersRef.current.forEach((marker) => marker.remove());
    sosMarkersRef.current = sosCases.map((item) => {
      const el = document.createElement("div");
      el.style.width = "18px";
      el.style.height = "18px";
      el.style.borderRadius = "4px";
      el.style.border = "2px solid white";
      el.style.background = item.urgencyLevel >= 9 ? "#ef4444" : item.urgencyLevel >= 7 ? "#f97316" : "#e11d48";
      el.style.boxShadow = "0 0 0 2px rgba(225,29,72,0.4)";
      const detail = [
        `緊急度 ${item.urgencyLevel}/10${item.isTrapped ? "・受困" : ""}`,
        item.locationDetails,
        item.injurySummary,
        item.rescueNeeds.length > 0 && `需要：${item.rescueNeeds.join("、")}`,
        item.batteryLevel !== null && `電量 ${item.batteryLevel}%`,
        item.bloodType && `血型 ${item.bloodType}`,
        item.drugAllergies && `藥物過敏：${item.drugAllergies}`,
        item.chronicConditions && `慢性病史：${item.chronicConditions}`,
      ].filter(Boolean).map((part) => escapeHtml(String(part))).join("<br/>");
      return new maplibregl.Marker({ element: el })
        .setLngLat([item.longitude, item.latitude])
        .setPopup(new maplibregl.Popup({ offset: 16 }).setHTML(
          `<strong>藍牙求救 · ${escapeHtml(item.username)}</strong><br/>${detail}`,
        ))
        .addTo(map);
    });
  }, [sosCases]);

  const nearbyPersonCases = personCases;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    personCaseMarkersRef.current.forEach((marker) => marker.remove());
    personCaseMarkersRef.current = nearbyPersonCases.map((item) => {
      const el = document.createElement("div");
      el.style.width = "20px";
      el.style.height = "20px";
      el.style.borderRadius = "50%";
      el.style.border = "3px solid white";
      el.style.background = "#7c3aed";
      el.style.boxShadow = "0 0 0 2px rgba(124,58,237,0.35)";
      const detail = [
        `狀態：${item.status}`,
        `優先級 ${item.priority}/5`,
        item.situation_summary || "尚無個案摘要",
      ].map((part) => escapeHtml(part)).join("<br/>");
      return new maplibregl.Marker({ element: el })
        .setLngLat([item.longitude, item.latitude])
        .setPopup(new maplibregl.Popup({ offset: 18 }).setHTML(`<strong>個人案件 · ${escapeHtml(item.label)}</strong><br/>${detail}`))
        .addTo(map);
    });
  }, [nearbyPersonCases]);

  const focusCase = (item: RescueCase) => {
    mapRef.current?.flyTo({ center: [item.longitude, item.latitude], zoom: 16 });
  };

  const focusSosCase = (item: SosCase) => {
    mapRef.current?.flyTo({ center: [item.longitude, item.latitude], zoom: 16 });
  };

  const focusPersonCase = (item: PersonRescueCase) => {
    mapRef.current?.flyTo({ center: [item.longitude, item.latitude], zoom: 16 });
  };

  const changeCaseStatus = async (kind: "cases" | "sos", id: string, status: string) => {
    try {
      await updateRescueStatus(kind, id, status);
      if (kind === "cases") setCases((current) => current.map((item) => item.caseId === id ? { ...item, status } : item));
      else setSosCases((current) => current.map((item) => item.msgId === id ? { ...item, status } : item));
    } catch (err) { setError(err instanceof Error ? err.message : "案件狀態更新失敗"); }
  };

  return (
    <div className="h-full flex flex-col bg-bg text-ink safe-area-top safe-area-bottom">
      <header className="shrink-0 flex items-center justify-between px-3 py-3 border-b border-line">
        {onBack ? <button onClick={onBack} className="tappable min-h-11 text-sm text-ink">← 返回</button> : <span />}
        <div className="text-center"><div className="font-bold">救援任務地圖</div><div className="text-[10px] text-muted">50 公里內 · 每 10 秒更新</div></div>
        <button onClick={refresh} disabled={loading} className="tappable min-h-11 text-sm text-accent disabled:opacity-50">{loading ? "更新中" : "手動更新"}</button>
      </header>
      {error && <div className="shrink-0 px-3 py-2 text-xs text-critical-text bg-critical-soft">{error}</div>}
      <div ref={containerRef} className="min-h-[45vh] flex-1" />
      <section className="pb-[var(--tabbar-clearance)] max-h-[38vh] overflow-y-auto border-t border-line bg-bg p-3 space-y-2">
        <div className="text-xs text-muted">
          既有救援案件 {cases.length} 人、個人案件 {nearbyPersonCases.length} 件、藍牙求救 {sosCases.length} 筆 · 綠色是你的位置、紫色是個人案件
        </div>
        {cases.length === 0 && sosCases.length === 0 && nearbyPersonCases.length === 0 && !loading && (
          <div className="py-6 text-center text-sm text-muted">附近目前沒有具 GPS 的待救援案件</div>
        )}
        {sosCases.map((item) => (
          <button
            key={item.msgId}
            onClick={() => focusSosCase(item)}
            className="tappable w-full text-left rounded-xl bg-critical-soft p-3 shadow-[var(--elev-soft)]"
          >
            <div className="flex justify-between gap-3">
              <span className="font-bold">藍牙求救 · {item.username}</span>
              <span className="text-critical-text">緊急度 {item.urgencyLevel}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2"><span className="text-xs text-muted">處理狀態</span><select aria-label="藍牙求救處理狀態" value={item.status || "待處理"} onChange={(event) => void changeCaseStatus("sos", item.msgId, event.target.value)} className="min-h-10 rounded-lg border border-line bg-bg px-2 text-xs">{["待處理", "已確認", "已派遣", "處理中", "已完成"].map((status) => <option key={status}>{status}</option>)}</select></div>
            <div className="mt-1 text-xs text-ink">
              距離 {item.distanceKm.toFixed(1)} km · 經 {item.hops} 跳送達
              {item.isTrapped ? " · 受困" : ""}
              {item.batteryLevel !== null ? ` · 電量 ${item.batteryLevel}%` : ""}
            </div>
            {item.locationDetails && (
              <div className="mt-1 text-xs text-muted">位置：{item.locationDetails}</div>
            )}
            <div className="mt-1 text-xs text-muted">
              {item.injurySummary || item.rescueNeeds.join("、") || "需要救援"}
            </div>
            {(item.bloodType || item.drugAllergies || item.chronicConditions) && (
              <div className="mt-1 text-xs text-accent">
                {[
                  item.bloodType && `血型 ${item.bloodType}`,
                  item.drugAllergies && `過敏：${item.drugAllergies}`,
                  item.chronicConditions && `慢性病：${item.chronicConditions}`,
                ].filter(Boolean).join(" · ")}
              </div>
            )}
          </button>
        ))}
        {cases.map((item) => (
          <button key={item.userId} onClick={() => focusCase(item)} className="tappable w-full text-left rounded-xl bg-surface-2 p-3 shadow-[var(--elev-soft)]">
            <div className="flex justify-between gap-3"><span className="font-bold">{item.username}</span><span className="text-critical-text">緊急度 {item.urgencyLevel}</span></div>
            <div className="mt-2 flex items-center justify-between gap-2"><span className="text-xs text-muted">處理狀態</span><select aria-label="救援案件處理狀態" value={item.status || "待處理"} onChange={(event) => void changeCaseStatus("cases", item.caseId, event.target.value)} className="min-h-10 rounded-lg border border-line bg-bg px-2 text-xs">{["待處理", "已確認", "已派遣", "處理中", "已完成"].map((status) => <option key={status}>{status}</option>)}</select></div>
            <div className="mt-1 text-xs text-ink">距離 {item.distanceKm.toFixed(1)} km{item.isTrapped ? " · 受困" : ""}</div>
            <div className="mt-1 text-xs text-muted">{item.injurySummary || item.rescueNeeds.join("、") || "需要救援"}</div>
          </button>
        ))}
        {nearbyPersonCases.map((item) => (
          <button
            key={item.id}
            onClick={() => focusPersonCase(item)}
            className="tappable w-full rounded-xl border border-violet-200 bg-violet-50 p-3 text-left shadow-[var(--elev-soft)]"
          >
            <div className="flex justify-between gap-3"><span className="font-bold text-violet-950">個人案件 · {item.label}</span><span className="text-violet-800">優先級 {item.priority}/5</span></div>
            <div className="mt-1 text-xs text-muted">狀態：{item.status} · 距離 {distanceKm(location!.lat, location!.lng, item.latitude, item.longitude).toFixed(1)} km</div>
            <div className="mt-1 text-xs text-muted">{item.situation_summary || "尚無個案摘要"}</div>
            <div className="mt-1 text-xs text-muted">位置 {item.latitude.toFixed(5)}, {item.longitude.toFixed(5)}</div>
          </button>
        ))}
      </section>
    </div>
  );
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] || char);
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRadians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = toRadians(lat2 - lat1);
  const longitudeDelta = toRadians(lon2 - lon1);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
