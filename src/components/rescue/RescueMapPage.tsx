import React, { useEffect, useRef, useState } from "react";
import maplibregl, { Map, Marker, GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { fetchNearbyRescueCases, fetchNearbySosReports, fetchNearbyFieldReports, FieldReport, RescueCase, SosCase } from "../../services/rescueService";

const CATEGORY_LABELS = { road: "道路", building: "建物", fire: "火災", utility: "民生設施", other: "其他觀察" };
const CATEGORY_COLORS = { road: "#f97316", building: "#8b5cf6", fire: "#ef4444", utility: "#0ea5e9", other: "#64748b" };
const reportTime = (item: FieldReport) => new Date(item.observed_at || item.received_at).toLocaleString("zh-TW", { hour12: false });

const RESCUE_REFRESH_INTERVAL_MS = 10_000;
// A display area around the reporter, not an inferred disaster boundary.
const FIELD_AREA_RADIUS_METERS = 300;
const FIELD_AREA_SOURCE = "field-report-areas";
const FIELD_AREA_FILL = "field-report-area-fill";
const FIELD_AREA_OUTLINE = "field-report-area-outline";

function fieldReportArea(item: FieldReport) {
  const lat = item.latitude * Math.PI / 180;
  const lon = item.longitude * Math.PI / 180;
  const angularRadius = FIELD_AREA_RADIUS_METERS / 6371000;
  const ring = Array.from({ length: 64 }, (_, index) => {
    const bearing = index * 2 * Math.PI / 64;
    const targetLat = Math.asin(Math.sin(lat) * Math.cos(angularRadius)
      + Math.cos(lat) * Math.sin(angularRadius) * Math.cos(bearing));
    const targetLon = lon + Math.atan2(Math.sin(bearing) * Math.sin(angularRadius) * Math.cos(lat),
      Math.cos(angularRadius) - Math.sin(lat) * Math.sin(targetLat));
    return [((targetLon * 180 / Math.PI + 540) % 360) - 180, targetLat * 180 / Math.PI];
  });
  ring.push([...ring[0]]);
  return {
    type: "Feature" as const,
    properties: { report_id: item.id, color: CATEGORY_COLORS[item.analysis?.category || "other"] },
    geometry: { type: "Polygon" as const, coordinates: [ring] },
  };
}

export function RescueMapPage({
  location,
  onBack,
}: {
  location: { lat: number; lng: number } | null;
  onBack: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const userMarkerRef = useRef<Marker | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const sosMarkersRef = useRef<Marker[]>([]);
  const [fieldReports, setFieldReports] = useState<FieldReport[]>([]);
  const [showFieldReports, setShowFieldReports] = useState(true);
  const [showRescue, setShowRescue] = useState(true);
  const locationRef = useRef(location);
  const refreshInFlightRef = useRef(false);
  const initialLoadStartedRef = useRef(false);
  const [mapLocation, setMapLocation] = useState(location);
  const [cases, setCases] = useState<RescueCase[]>([]);
  const [sosCases, setSosCases] = useState<SosCase[]>([]);
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
    // 兩種資料來源獨立擷取：其中一種載入失敗（例如求救記錄的後端還沒部署）
    // 不該連帶讓另一種也顯示不出來。
    const [rescueResult, sosResult, fieldResult] = await Promise.allSettled([
      fetchNearbyRescueCases(currentLocation),
      fetchNearbySosReports(currentLocation),
      fetchNearbyFieldReports(currentLocation),
    ]);
    if (rescueResult.status === "fulfilled") setCases(rescueResult.value);
    if (sosResult.status === "fulfilled") setSosCases(sosResult.value);
    if (fieldResult.status === "fulfilled") setFieldReports(fieldResult.value);
    const failures = [rescueResult, sosResult, fieldResult]
      .flatMap((result) => result.status === "rejected" ? [result.reason instanceof Error ? result.reason.message : "部分資料載入失敗"] : []);
    setError(failures.join("；"));
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
    markersRef.current = (showRescue ? cases : []).map((item) => {
      const color = item.urgencyLevel >= 9 ? "#ef4444" : item.urgencyLevel >= 7 ? "#f97316" : "#eab308";
      return new maplibregl.Marker({ color })
        .setLngLat([item.longitude, item.latitude])
        .setPopup(new maplibregl.Popup({ offset: 24 }).setHTML(
          `<strong>${escapeHtml(item.username)}</strong><br/>緊急度 ${item.urgencyLevel}/10<br/>${escapeHtml(item.injurySummary || item.rescueNeeds.join("、") || "需要救援")}`,
        ))
        .addTo(map);
    });
  }, [cases, showRescue, mapLocation]);

  // 藍牙中繼的求救：用不同的圖示（方形 DOM marker）跟 AI 評估案件的圓形 pin 區分開，
  // 一眼就能看出「這筆是透過藍牙中繼送達的」。
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    sosMarkersRef.current.forEach((marker) => marker.remove());
    sosMarkersRef.current = (showRescue ? sosCases : []).map((item) => {
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
  }, [sosCases, showRescue, mapLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let activePopup: maplibregl.Popup | undefined;
    const updateAreas = () => {
      const data = { type: "FeatureCollection" as const, features: fieldReports.map(fieldReportArea) };
      const source = map.getSource(FIELD_AREA_SOURCE) as GeoJSONSource | undefined;
      if (source) source.setData(data);
      else map.addSource(FIELD_AREA_SOURCE, { type: "geojson", data });
      if (!map.getLayer(FIELD_AREA_FILL)) map.addLayer({
        id: FIELD_AREA_FILL, type: "fill", source: FIELD_AREA_SOURCE,
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.18 },
      });
      if (!map.getLayer(FIELD_AREA_OUTLINE)) map.addLayer({
        id: FIELD_AREA_OUTLINE, type: "line", source: FIELD_AREA_SOURCE,
        paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.8, "line-dasharray": [3, 2] },
      });
      for (const layer of [FIELD_AREA_FILL, FIELD_AREA_OUTLINE]) {
        map.setLayoutProperty(layer, "visibility", showFieldReports ? "visible" : "none");
      }
    };
    const showAreaDetails = (event: maplibregl.MapLayerMouseEvent) => {
      const ids = new Set(event.features?.map((feature) => feature.properties?.report_id));
      const reports = fieldReports.filter((item) => ids.has(item.id));
      if (!reports.length) return;
      const popup = document.createElement("div");
      popup.style.whiteSpace = "pre-wrap";
      popup.style.maxHeight = "240px";
      popup.style.overflowY = "auto";
      popup.textContent = `災情回報區域 · 未查證\n以回報者位置為中心、半徑 ${FIELD_AREA_RADIUS_METERS} 公尺的示意範圍，非實際災區邊界。\n\n`
        + reports.map((item) => `${CATEGORY_LABELS[item.analysis?.category || "other"]} · 未查證\n${item.analysis?.summary || item.observation}\n觀察時間：${reportTime(item)}\n回報編號：${item.id}`).join("\n\n");
      activePopup?.remove();
      activePopup = new maplibregl.Popup({ maxWidth: "320px" })
        .setLngLat(event.lngLat).setDOMContent(popup).addTo(map);
    };
    const enter = () => { map.getCanvas().style.cursor = "pointer"; };
    const leave = () => { map.getCanvas().style.cursor = ""; };
    // Data can arrive before the base style has loaded.
    if (map.isStyleLoaded()) updateAreas();
    else map.once("load", updateAreas);
    map.on("click", FIELD_AREA_FILL, showAreaDetails);
    map.on("mouseenter", FIELD_AREA_FILL, enter);
    map.on("mouseleave", FIELD_AREA_FILL, leave);
    return () => {
      map.off("load", updateAreas);
      map.off("click", FIELD_AREA_FILL, showAreaDetails);
      map.off("mouseenter", FIELD_AREA_FILL, enter);
      map.off("mouseleave", FIELD_AREA_FILL, leave);
      activePopup?.remove();
      if (mapRef.current === map) map.getCanvas().style.cursor = "";
    };
  }, [fieldReports, showFieldReports, mapLocation]);

  const focusCase = (item: RescueCase) => {
    mapRef.current?.flyTo({ center: [item.longitude, item.latitude], zoom: 16 });
  };

  const focusSosCase = (item: SosCase) => {
    mapRef.current?.flyTo({ center: [item.longitude, item.latitude], zoom: 16 });
  };

  return (
    <div className="h-full flex flex-col bg-bg text-ink safe-area-top safe-area-bottom">
      <header className="shrink-0 flex items-center justify-between px-3 py-3 border-b border-line">
        <button onClick={onBack} className="tappable min-h-11 text-sm text-ink">← 返回</button>
        <div className="text-center"><div className="font-bold">救援任務地圖</div><div className="text-[10px] text-muted">50 公里內 · 每 10 秒更新</div></div>
        <button onClick={refresh} disabled={loading} className="tappable min-h-11 text-sm text-accent disabled:opacity-50">{loading ? "更新中" : "手動更新"}</button>
      </header>
      {error && <div className="shrink-0 px-3 py-2 text-xs text-critical-text bg-critical-soft">{error}</div>}
      <div className="shrink-0 flex gap-4 px-3 py-2 text-xs border-b border-line">
        <label><input type="checkbox" checked={showRescue} onChange={(event) => setShowRescue(event.target.checked)} /> 求救案件</label>
        <label><input type="checkbox" checked={showFieldReports} onChange={(event) => setShowFieldReports(event.target.checked)} /> 災情區域（依類型著色）</label>
      </div>
      {showFieldReports && (
        <div className="shrink-0 flex flex-wrap gap-x-4 gap-y-2 px-3 py-2 text-xs border-b border-line" aria-label="災情分類顏色圖例">
          {(Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>).map((category) => (
            <span key={category} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm border-2" style={{ borderColor: CATEGORY_COLORS[category], backgroundColor: `${CATEGORY_COLORS[category]}30` }} />
              {CATEGORY_LABELS[category]}
            </span>
          ))}
        </div>
      )}
      <div ref={containerRef} className="min-h-[45vh] flex-1" />
      <section className="pb-[var(--tabbar-clearance)] max-h-[38vh] overflow-y-auto border-t border-line bg-bg p-3 space-y-2">
        <div className="text-xs text-muted">
          待救援 {cases.length} 人、藍牙求救 {sosCases.length} 筆、災情回報 {fieldReports.length} 筆 · 綠色是你的位置
        </div>
        {cases.length === 0 && sosCases.length === 0 && fieldReports.length === 0 && !loading && (
          <div className="py-6 text-center text-sm text-muted">附近目前沒有具 GPS 的待救援案件</div>
        )}
        {showFieldReports && <div className="text-xs text-muted">災情顯示最近 24 小時，最多 300 筆。各色區域為回報者周圍 300 公尺的示意範圍，非實際災區邊界；回報均未查證。</div>}
        {(showFieldReports ? fieldReports : []).map((item) => (
          <article key={item.id} className="rounded-xl bg-surface-2 p-3 space-y-1">
            <button className="tappable w-full text-left" onClick={() => mapRef.current?.flyTo({ center: [item.longitude, item.latitude], zoom: 15 })}>
              <div className="font-bold flex items-center gap-2"><span aria-hidden="true" className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: CATEGORY_COLORS[item.analysis?.category || "other"] }} />{CATEGORY_LABELS[item.analysis?.category || "other"]} · 未查證</div>
              <div className="text-xs text-muted">距離 {item.distance_km.toFixed(1)} km · 觀察時間 {reportTime(item)}</div>
              <div className="text-sm whitespace-pre-wrap">{item.analysis?.summary || item.observation}</div>
            </button>
            {item.analysis && <div className="text-xs">AI 整理 · 影響：{item.analysis.impact}<br />地點描述：{item.analysis.location_description}</div>}
            <div className="text-xs text-muted">回報者周圍 300 公尺示意區域 · 實際災情範圍待確認 · {item.analysis_status === "pending" ? "整理中" : item.analysis_status === "unavailable" ? "顯示原始回報" : "已整理"}</div>
            <details className="text-xs">
              <summary className="tappable cursor-pointer">查看來源原文</summary>
              <p className="whitespace-pre-wrap break-words">{item.observation}</p>
              <p>來源：使用者現場回報 · 編號 {item.id}</p>
              <p>收到時間：{new Date(item.received_at).toLocaleString("zh-TW", { hour12: false })}</p>
            </details>
          </article>
        ))}
        {(showRescue ? sosCases : []).map((item) => (
          <button
            key={item.msgId}
            onClick={() => focusSosCase(item)}
            className="tappable w-full text-left rounded-xl bg-critical-soft p-3 shadow-[var(--elev-soft)]"
          >
            <div className="flex justify-between gap-3">
              <span className="font-bold">藍牙求救 · {item.username}</span>
              <span className="text-critical-text">緊急度 {item.urgencyLevel}</span>
            </div>
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
        {(showRescue ? cases : []).map((item) => (
          <button key={item.userId} onClick={() => focusCase(item)} className="tappable w-full text-left rounded-xl bg-surface-2 p-3 shadow-[var(--elev-soft)]">
            <div className="flex justify-between gap-3"><span className="font-bold">{item.username}</span><span className="text-critical-text">緊急度 {item.urgencyLevel}</span></div>
            <div className="mt-1 text-xs text-ink">距離 {item.distanceKm.toFixed(1)} km{item.isTrapped ? " · 受困" : ""}</div>
            <div className="mt-1 text-xs text-muted">{item.injurySummary || item.rescueNeeds.join("、") || "需要救援"}</div>
          </button>
        ))}
      </section>
    </div>
  );
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] || char);
}
