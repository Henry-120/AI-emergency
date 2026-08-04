/**
 * GuardiaAI - 在離線地圖上顯示「對方在哪、我在哪」
 *
 * 兩種情境共用：附近某人分享過的位置、以及藍牙求救封包帶來的位置。
 *
 * **刻意使用離線底圖（打包在 App 內的 PMTiles），不是救援地圖那張線上 OSM。**
 * 藍牙傳訊與多跳求救會發生的情境本來就是沒有網路——用線上圖磚的話，最需要看
 * 地圖的當下只會看到一片空白。圖磚讀不到時退回顯示原始座標，至少能抄下來
 * 轉述給救難單位，不會變成完全無用的畫面。
 */

import React, { useEffect, useRef, useState } from "react";
import maplibregl, { Map, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  getStreetStyle,
  isPmtilesAvailable,
  registerPmtilesProtocol,
} from "../offline/offlineMapStyle";
import { bearingDeg, distanceKm, headingText } from "../../services/offlineSafetyService";

interface Props {
  /** 頁面標題 */
  title: string;
  /** 對方的位置；null 代表我們根本不知道對方在哪 */
  target: { lat: number; lng: number } | null;
  myLocation: { lat: number; lng: number } | null;
  /** 地圖上紅色標記的說明文字 */
  targetLabel: string;
  /** 標題列下方的補充資訊（緊急度、分享時間等，各情境不同） */
  details?: React.ReactNode;
  /** target 為 null 時要說明的原因 */
  emptyMessage: React.ReactNode;
  onBack: () => void;
}

export function LocationMapView({
  title,
  target,
  myLocation,
  targetLabel,
  details,
  emptyMessage,
  onBack,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const [mapReady, setMapReady] = useState<boolean | null>(null); // null = 還在確認圖磚

  const km =
    myLocation && target
      ? distanceKm(myLocation.lat, myLocation.lng, target.lat, target.lng)
      : null;
  const heading =
    myLocation && target
      ? headingText(bearingDeg(myLocation.lat, myLocation.lng, target.lat, target.lng))
      : null;
  const distanceText =
    km === null ? null : km < 1 ? `${Math.round(km * 1000)} 公尺` : `${km.toFixed(1)} 公里`;

  useEffect(() => {
    let cancelled = false;
    void isPmtilesAvailable().then((ok) => {
      if (!cancelled) setMapReady(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !containerRef.current || !target || mapRef.current) return;

    registerPmtilesProtocol();

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getStreetStyle(),
      center: [target.lng, target.lat],
      zoom: 16,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
    mapRef.current = map;

    const markers: Marker[] = [
      new maplibregl.Marker({ color: "#e11d48" })
        .setLngLat([target.lng, target.lat])
        .setPopup(new maplibregl.Popup({ offset: 24 }).setText(targetLabel))
        .addTo(map),
    ];

    if (myLocation) {
      markers.push(
        new maplibregl.Marker({ color: "#22c55e" })
          .setLngLat([myLocation.lng, myLocation.lat])
          .setPopup(new maplibregl.Popup({ offset: 24 }).setText("你的位置"))
          .addTo(map),
      );

      // 兩點都在時把視野拉到剛好都看得到，使用者才知道要往哪走
      map.fitBounds(
        [
          [Math.min(myLocation.lng, target.lng), Math.min(myLocation.lat, target.lat)],
          [Math.max(myLocation.lng, target.lng), Math.max(myLocation.lat, target.lat)],
        ],
        { padding: 80, maxZoom: 17, duration: 0 },
      );

      map.on("load", () => {
        map.addSource("route", {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: [
                [myLocation.lng, myLocation.lat],
                [target.lng, target.lat],
              ],
            },
            properties: {},
          },
        });
        map.addLayer({
          id: "route",
          type: "line",
          source: "route",
          paint: {
            "line-color": "#e11d48",
            "line-width": 3,
            "line-dasharray": [2, 1.5],
          },
        });
      });
    }

    return () => {
      markers.forEach((m) => m.remove());
      map.remove();
      mapRef.current = null;
    };
  }, [mapReady, target?.lat, target?.lng, myLocation?.lat, myLocation?.lng, targetLabel]);

  return (
    <div className="h-screen flex flex-col bg-[#020617] overflow-hidden">
      <header className="glass-panel safe-area-top px-4 py-3 flex items-center gap-3 border-b border-white/5">
        <button onClick={onBack} className="text-slate-400 hover:text-white text-sm">
          ← 返回
        </button>
        <div className="text-white font-bold">{title}</div>
      </header>

      {(details || distanceText || (target && !myLocation)) && (
        <div className="shrink-0 px-4 py-3 bg-slate-900/60 border-b border-white/5 space-y-1">
          {details}
          {distanceText && heading && (
            <div className="text-amber-200 text-sm font-semibold">
              在你的 {heading}方 {distanceText}
            </div>
          )}
          {target && !myLocation && (
            <div className="text-[11px] text-slate-400">
              你目前沒有定位，無法計算距離與方向
            </div>
          )}
        </div>
      )}

      {!target ? (
        <div className="flex-1 flex items-center justify-center px-8">
          <div className="text-center text-slate-400 text-sm leading-relaxed">{emptyMessage}</div>
        </div>
      ) : mapReady === false ? (
        // 圖磚讀不到：不要留一片空白，把座標交出來讓使用者能轉述給救難單位
        <div className="flex-1 flex items-center justify-center px-8">
          <div className="text-center text-slate-300 text-sm leading-relaxed">
            離線地圖無法載入，以下是原始座標：
            <div className="mt-2 font-mono text-amber-300">
              {target.lat.toFixed(5)}, {target.lng.toFixed(5)}
            </div>
          </div>
        </div>
      ) : (
        <div ref={containerRef} className="flex-1" />
      )}

      {target && (
        <div className="shrink-0 px-4 py-2 text-[11px] text-slate-500 border-t border-white/5">
          座標 {target.lat.toFixed(5)}, {target.lng.toFixed(5)}
        </div>
      )}
    </div>
  );
}
