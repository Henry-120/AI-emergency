import React, { useEffect, useRef, useState } from "react";
import maplibregl, { Map, Marker, GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { fetchNearbyRescueCases, fetchNearbySosReports, fetchNearbyFieldReports, FieldReport, RescueCase, SosCase } from "../../services/rescueService";
import { CATEGORY_COLORS, CATEGORY_LABELS, DisasterCategory } from "../../services/disasterCategories";
import { createHazardPin, deleteHazardPin, fetchNearbyHazardPins, HazardPin, updateHazardPin } from "../../services/hazardPinService";
import { buildNearbySignals, describeNearbySignal, NearbySignal } from "../../services/nearbyBluetoothSignals";
import { getRecords, subscribeInbox } from "../../services/bluetooth/bluetoothInbox";
import { getNearbySosSightings, subscribeSosStatus } from "../../services/sos/sosRelay";
import { HazardPinEditor } from "./HazardPinEditor";
import { MyStatusCard } from "./MyStatusCard";
import { createHazardPinElement, createNearbySignalElement, hazardPinSvg } from "./statusStyles";
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

/** 釘選中：新增一個標記，或修改自己的某個標記（位置用地圖中央的十字決定）。 */
type Placing = { mode: "create" } | { mode: "edit"; pin: HazardPin };

/**
 * 同一張地圖，依使用者身分顯示不同圖層：
 * - public（一般使用者）：自己的狀況、藍牙實際收到的附近訊號、災情色塊、使用者釘選的災情。
 *   看不到別人的救援案件和醫療資料。
 * - rescue（救援端）：再加上所有救援案件和藍牙求救（後端資料）。
 */
export function RescueMapPage({
  location,
  onBack,
  viewer = "public",
}: {
  location: { lat: number; lng: number } | null;
  onBack: () => void;
  viewer?: "public" | "rescue";
}) {
  const isRescue = viewer === "rescue";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const userMarkerRef = useRef<Marker | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const sosMarkersRef = useRef<Marker[]>([]);
  const [fieldReports, setFieldReports] = useState<FieldReport[]>([]);
  const [showFieldReports, setShowFieldReports] = useState(true);
  const [showRescue, setShowRescue] = useState(true);
  const [showNearby, setShowNearby] = useState(true);
  const [hazardPins, setHazardPins] = useState<HazardPin[]>([]);
  const [nearbySignals, setNearbySignals] = useState<NearbySignal[]>([]);
  const pinMarkersRef = useRef<Marker[]>([]);
  const nearbyMarkersRef = useRef<Marker[]>([]);
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [placingCategory, setPlacingCategory] = useState<DisasterCategory | null>(null);
  const [pinSaving, setPinSaving] = useState(false);
  const [pinError, setPinError] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
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
      setError("尚未取得你的位置，請允許定位權限");
      return;
    }
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setLoading(true);
    setError("");
    // 兩種資料來源獨立擷取：其中一種載入失敗（例如求救記錄的後端還沒部署）
    // 不該連帶讓另一種也顯示不出來。
    // 別人的救援案件和藍牙求救只給救援端；一般使用者不抓這兩種資料。
    const skip = Promise.resolve([] as never[]);
    const [rescueResult, sosResult, fieldResult, pinResult] = await Promise.allSettled([
      isRescue ? fetchNearbyRescueCases(currentLocation) : skip,
      isRescue ? fetchNearbySosReports(currentLocation) : skip,
      fetchNearbyFieldReports(currentLocation),
      fetchNearbyHazardPins(currentLocation),
    ]);
    if (rescueResult.status === "fulfilled") setCases(rescueResult.value);
    if (sosResult.status === "fulfilled") setSosCases(sosResult.value);
    if (fieldResult.status === "fulfilled") setFieldReports(fieldResult.value);
    if (pinResult.status === "fulfilled") setHazardPins(pinResult.value);
    const failures = [rescueResult, sosResult, fieldResult, pinResult]
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
    markersRef.current = (isRescue && showRescue ? cases : []).map((item) => {
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
    sosMarkersRef.current = (isRescue && showRescue ? sosCases : []).map((item) => {
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
      // 釘選或修改標記時，點地圖是在移動十字，不要跳出區域說明。
      if (placing) return;
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
  }, [fieldReports, showFieldReports, mapLocation, placing]);

  // 藍牙實際收到的附近訊號（只在手機本機，斷網也能用）。沒有藍牙接觸就看不到其他人。
  useEffect(() => {
    if (isRescue) return;
    const update = () => setNearbySignals(buildNearbySignals(getNearbySosSightings(), getRecords()));
    update();
    const unsubscribeSos = subscribeSosStatus(update);
    const unsubscribeInbox = subscribeInbox(update);
    // 訊號會過期，沒有新封包時也要定期重算。
    const interval = window.setInterval(update, 30_000);
    return () => {
      unsubscribeSos();
      unsubscribeInbox();
      window.clearInterval(interval);
    };
  }, [isRescue]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    nearbyMarkersRef.current.forEach((marker) => marker.remove());
    nearbyMarkersRef.current = (!isRescue && showNearby ? nearbySignals : []).map((signal) => {
      const label = describeNearbySignal(signal);
      return new maplibregl.Marker({ element: createNearbySignalElement(signal.kind, signal.trapped, label) })
        .setLngLat([signal.longitude, signal.latitude])
        .setPopup(new maplibregl.Popup({ offset: 14 }).setText(`${label} · ${formatTime(signal.lastSeenAt)} 收到`))
        .addTo(map);
    });
  }, [nearbySignals, showNearby, isRescue, mapLocation]);

  // 使用者釘選的災情：水滴形標記，顏色跟災情色塊同一套分類。正在修改的那個先藏起來，
  // 位置交給地圖中央的十字。
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    pinMarkersRef.current.forEach((marker) => marker.remove());
    const editingId = placing?.mode === "edit" ? placing.pin.id : null;
    pinMarkersRef.current = (showFieldReports ? hazardPins : [])
      .filter((pin) => pin.id !== editingId)
      .map((pin) => new maplibregl.Marker({
        element: createHazardPinElement(CATEGORY_COLORS[pin.category], `災情標記：${CATEGORY_LABELS[pin.category]}`),
        anchor: "bottom",
      })
        .setLngLat([pin.longitude, pin.latitude])
        .setPopup(new maplibregl.Popup({ offset: 30, maxWidth: "280px" }).setDOMContent(pinPopup(pin)))
        .addTo(map));
  }, [hazardPins, showFieldReports, mapLocation, placing]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const focusPoint = (point: { latitude: number; longitude: number }) => {
    mapRef.current?.flyTo({ center: [point.longitude, point.latitude], zoom: 16 });
  };

  const startPlacing = () => {
    setPinError("");
    setPlacingCategory(null);
    setPlacing({ mode: "create" });
  };

  const startEditing = (pin: HazardPin) => {
    setPinError("");
    setPlacingCategory(pin.category);
    setPlacing({ mode: "edit", pin });
    mapRef.current?.flyTo({ center: [pin.longitude, pin.latitude], zoom: Math.max(mapRef.current.getZoom(), 16) });
  };

  const savePin = async (category: DisasterCategory, note: string) => {
    const map = mapRef.current;
    if (!map || !placing) return;
    const center = map.getCenter();
    const input = { category, note, latitude: center.lat, longitude: center.lng };
    setPinSaving(true);
    setPinError("");
    try {
      if (placing.mode === "edit") {
        const saved = await updateHazardPin(placing.pin.id, input);
        setHazardPins((pins) => pins.map((pin) => (pin.id === saved.id ? { ...saved, distance_km: pin.distance_km } : pin)));
        setNotice(`已更新「${CATEGORY_LABELS[saved.category]}」標記。`);
      } else {
        const saved = await createHazardPin(input);
        setHazardPins((pins) => [saved, ...pins]);
        setNotice(`已標記「${CATEGORY_LABELS[saved.category]}」，附近的人都看得到。`);
      }
      setShowFieldReports(true);
      setPlacing(null);
    } catch (saveError) {
      setPinError(saveError instanceof Error ? saveError.message : "標記失敗，請稍後再試");
    } finally {
      setPinSaving(false);
    }
  };

  const removePin = async (pin: HazardPin) => {
    // 刪除要按兩次，避免手抖誤刪。
    if (confirmDeleteId !== pin.id) {
      setConfirmDeleteId(pin.id);
      return;
    }
    setConfirmDeleteId(null);
    try {
      await deleteHazardPin(pin.id);
      setHazardPins((pins) => pins.filter((item) => item.id !== pin.id));
      setNotice(`已刪除「${CATEGORY_LABELS[pin.category]}」標記。`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "刪除失敗，請稍後再試");
    }
  };

  /** 地圖上點標記時的說明；自己標的可以直接修改或刪除。 */
  function pinPopup(pin: HazardPin): HTMLElement {
    const root = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${CATEGORY_LABELS[pin.category]} · 使用者標記・未查證`;
    root.append(title);
    if (pin.note) {
      const note = document.createElement("p");
      note.style.margin = "4px 0 0";
      note.textContent = pin.note;
      root.append(note);
    }
    const meta = document.createElement("p");
    meta.style.margin = "4px 0 0";
    meta.style.fontSize = "12px";
    meta.style.color = "#586271";
    meta.textContent = `${formatTime(Date.parse(pin.updated_at))} 標記${pin.mine ? " · 你標記的" : ""}`;
    root.append(meta);
    if (pin.mine) {
      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "8px";
      actions.style.marginTop = "8px";
      const edit = popupButton("修改", () => startEditing(pin));
      const remove = popupButton("刪除", () => {
        if (remove.dataset.confirm !== "1") {
          remove.dataset.confirm = "1";
          remove.textContent = "確定刪除？";
          remove.style.color = "#9c121b";
          return;
        }
        void deleteHazardPin(pin.id)
          .then(() => {
            setHazardPins((pins) => pins.filter((item) => item.id !== pin.id));
            setNotice(`已刪除「${CATEGORY_LABELS[pin.category]}」標記。`);
          })
          .catch((deleteError) => setError(deleteError instanceof Error ? deleteError.message : "刪除失敗，請稍後再試"));
      });
      actions.append(edit, remove);
      root.append(actions);
    }
    return root;
  }

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
      {notice && <div role="status" className="shrink-0 px-3 py-2 text-xs text-safe-text bg-safe-soft">{notice}</div>}
      <div className="shrink-0 flex gap-4 px-3 py-2 text-xs border-b border-line">
        {isRescue
          ? <label><input type="checkbox" checked={showRescue} onChange={(event) => setShowRescue(event.target.checked)} /> 求救案件</label>
          : <label><input type="checkbox" checked={showNearby} onChange={(event) => setShowNearby(event.target.checked)} /> 附近的人（藍牙）</label>}
        <label><input type="checkbox" checked={showFieldReports} onChange={(event) => setShowFieldReports(event.target.checked)} /> 災情（依類型著色）</label>
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
      {/* 地圖容器跟原本一樣自己帶 min-h，不用 absolute：MapLibre 會在容器加上 position: relative
          蓋掉 absolute，而且建立當下量到的高度就是畫布高度，之後不一定會跟著外框長大。 */}
      <div className="relative flex min-h-[45vh] flex-1 flex-col">
        <div ref={containerRef} className="min-h-[45vh] flex-1" />
        {placing ? (
          // 地圖中央的十字：水滴的尖端就是標記的位置。
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10">
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full drop-shadow"
              dangerouslySetInnerHTML={{ __html: hazardPinSvg(placingCategory ? CATEGORY_COLORS[placingCategory] : "#1b2026") }}
            />
            <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/60" />
          </div>
        ) : (
          mapLocation && (
            <button
              onClick={startPlacing}
              className="tappable absolute bottom-3 left-3 z-10 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-bold text-white shadow-[var(--elev-2)]"
            >
              <i className="fas fa-location-dot" aria-hidden="true"></i>
              標記災情
            </button>
          )
        )}
      </div>
      <section className="pb-[var(--tabbar-clearance)] max-h-[38vh] overflow-y-auto border-t border-line bg-bg p-3 space-y-2">
        {placing ? (
          <HazardPinEditor
            key={placing.mode === "edit" ? placing.pin.id : "create"}
            mode={placing.mode}
            initialCategory={placing.mode === "edit" ? placing.pin.category : undefined}
            initialNote={placing.mode === "edit" ? placing.pin.note : ""}
            saving={pinSaving}
            error={pinError}
            onCategoryChange={setPlacingCategory}
            onCancel={() => setPlacing(null)}
            onSave={(category, note) => void savePin(category, note)}
          />
        ) : (
        <>
        {!isRescue && <MyStatusCard location={location} />}
        {!isRescue && showNearby && (
          <div className="pt-1 text-xs text-muted">
            {nearbySignals.length > 0
              ? `藍牙收到附近 ${nearbySignals.length} 個訊號，只顯示位置和是否受困。`
              : "附近還沒有用藍牙收到其他人的求救或存活訊號。"}
          </div>
        )}
        {(!isRescue && showNearby ? nearbySignals : []).map((signal) => (
          <button key={signal.key} onClick={() => focusPoint(signal)} className={`tappable w-full text-left rounded-xl p-3 shadow-[var(--elev-soft)] ${signal.kind === "sos" && signal.trapped ? "bg-critical-soft" : "bg-surface-2"}`}>
            <div className="font-bold">{describeNearbySignal(signal)}</div>
            <div className="mt-1 text-xs text-muted">{formatTime(signal.lastSeenAt)} 用藍牙收到</div>
          </button>
        ))}
        {showFieldReports && hazardPins.length > 0 && (
          <div className="pt-1 text-xs text-muted">水滴標記是使用者自己釘選的災情，所有人都看得到；按「標記災情」可以新增。</div>
        )}
        {(showFieldReports ? hazardPins : []).map((pin) => (
          <article key={pin.id} className="rounded-xl bg-surface-2 p-3 space-y-1">
            <button className="tappable w-full text-left" onClick={() => focusPoint(pin)}>
              <div className="font-bold flex items-center gap-2">
                <span aria-hidden="true" className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[pin.category] }} />
                {CATEGORY_LABELS[pin.category]} · 使用者標記・未查證
              </div>
              <div className="text-xs text-muted">
                {pin.distance_km != null ? `距離 ${pin.distance_km.toFixed(1)} km · ` : ""}{formatTime(Date.parse(pin.updated_at))} 標記{pin.mine ? " · 你標記的" : ""}
              </div>
              {pin.note && <div className="text-sm whitespace-pre-wrap">{pin.note}</div>}
            </button>
            {pin.mine && (
              <div className="flex gap-2 pt-1">
                <button onClick={() => startEditing(pin)} className="tappable min-h-11 rounded-xl border border-line bg-surface px-3 text-xs font-bold text-ink">修改</button>
                <button
                  onClick={() => void removePin(pin)}
                  className={`tappable min-h-11 rounded-xl border px-3 text-xs font-bold ${confirmDeleteId === pin.id ? "border-critical bg-critical-soft text-critical-text" : "border-line bg-surface text-ink"}`}
                >
                  {confirmDeleteId === pin.id ? "確定刪除？" : "刪除"}
                </button>
              </div>
            )}
          </article>
        ))}
        {isRescue ? (
          <>
            <div className="text-xs text-muted">
              待救援 {cases.length} 人、藍牙求救 {sosCases.length} 筆、災情回報 {fieldReports.length} 筆 · 綠色是你的位置
            </div>
            {cases.length === 0 && sosCases.length === 0 && fieldReports.length === 0 && !loading && (
              <div className="py-6 text-center text-sm text-muted">附近目前沒有具 GPS 的待救援案件</div>
            )}
          </>
        ) : (
          <div className="text-xs text-muted">
            災情回報 {fieldReports.length} 筆、使用者標記 {hazardPins.length} 個 · 綠色是你的位置
          </div>
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
        {(isRescue && showRescue ? sosCases : []).map((item) => (
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
        {(isRescue && showRescue ? cases : []).map((item) => (
          <button key={item.userId} onClick={() => focusCase(item)} className="tappable w-full text-left rounded-xl bg-surface-2 p-3 shadow-[var(--elev-soft)]">
            <div className="flex justify-between gap-3"><span className="font-bold">{item.username}</span><span className="text-critical-text">緊急度 {item.urgencyLevel}</span></div>
            <div className="mt-1 text-xs text-ink">距離 {item.distanceKm.toFixed(1)} km{item.isTrapped ? " · 受困" : ""}</div>
            <div className="mt-1 text-xs text-muted">{item.injurySummary || item.rescueNeeds.join("、") || "需要救援"}</div>
          </button>
        ))}
        </>
        )}
      </section>
    </div>
  );
}

function popupButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.minHeight = "36px";
  button.style.padding = "0 12px";
  button.style.border = "1px solid #d3dae3";
  button.style.borderRadius = "10px";
  button.style.background = "#fff";
  button.style.fontWeight = "700";
  button.style.fontSize = "13px";
  button.addEventListener("click", onClick);
  return button;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString("zh-TW", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] || char);
}
