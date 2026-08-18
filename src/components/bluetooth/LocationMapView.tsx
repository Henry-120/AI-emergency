/**
 * GuardiaAI - 在離線地圖上顯示「對方在哪、我在哪」
 *
 * 兩種情境共用：附近某人分享過的位置、以及藍牙求救封包帶來的位置。
 *
 * **刻意使用離線底圖（打包在 App 內的 PMTiles），不是救援地圖那張線上 OSM。**
 * 藍牙傳訊與多跳求救會發生的情境本來就是沒有網路——用線上圖磚的話，最需要看
 * 地圖的當下只會看到一片空白。圖磚讀不到時退回顯示原始座標，至少能抄下來
 * 轉述給救難單位，不會變成完全無用的畫面。
 *
 * 版面重點：使用者打開這頁是為了「往那邊走」。方向與距離做成整頁最大的一行，
 * 邊走邊瞄一眼就讀得到；地圖是佐證，座標是最後的退路。
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

/** 標記顏色。與 command surface 的 critical / safe token 同值 */
const TARGET_COLOR = "#e0454e";
const ME_COLOR = "#2f9d5b";

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
      new maplibregl.Marker({ color: TARGET_COLOR })
        .setLngLat([target.lng, target.lat])
        .setPopup(new maplibregl.Popup({ offset: 24 }).setText(targetLabel))
        .addTo(map),
    ];

    if (myLocation) {
      markers.push(
        new maplibregl.Marker({ color: ME_COLOR })
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
            "line-color": TARGET_COLOR,
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
          <div className="min-w-0 truncate text-[1.0625rem] font-bold text-ink">{title}</div>
        </div>
      </header>

      {(details || distanceText || (target && !myLocation)) && (
        <div className="shrink-0 border-b border-line bg-surface px-4 py-3">
          {/* 「往哪走、還有多遠」是這頁的主角，字級明顯大過其他資訊 */}
          {distanceText && heading && (
            <div className="text-[1.5rem] font-black leading-tight text-ink">
              往{heading}方 {distanceText}
            </div>
          )}
          {details && <div className="mt-1.5 space-y-1">{details}</div>}
          {target && !myLocation && (
            <div className="mt-1.5 text-sm text-muted">你目前沒有定位，無法計算距離與方向</div>
          )}
        </div>
      )}

      {!target ? (
        <div className="flex flex-1 items-center justify-center px-8">
          <div className="max-w-[34ch] text-center text-base leading-relaxed text-muted">
            {emptyMessage}
          </div>
        </div>
      ) : mapReady === false ? (
        // 圖磚讀不到：不要留一片空白，把座標交出來讓使用者能轉述給救難單位
        <div className="flex flex-1 items-center justify-center px-8">
          <div className="text-center">
            <p className="text-base leading-relaxed text-ink">
              離線地圖無法載入，以下是原始座標：
            </p>
            <div className="mt-3 select-all rounded-xl border border-line bg-surface px-4 py-3 font-data text-[1.25rem] font-bold text-ink">
              {target.lat.toFixed(5)}, {target.lng.toFixed(5)}
            </div>
            <p className="mt-2 text-sm text-muted">可以直接唸給救難單位或抄下來。</p>
          </div>
        </div>
      ) : (
        <div ref={containerRef} className="flex-1" />
      )}

      {target && (
        <div className="safe-area-bottom shrink-0 border-t border-line bg-surface px-4 pt-2.5 text-sm text-muted">
          座標{" "}
          <span className="font-data">
            {target.lat.toFixed(5)}, {target.lng.toFixed(5)}
          </span>
        </div>
      )}
    </div>
  );
}
