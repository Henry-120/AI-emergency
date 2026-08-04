/**
 * 離線街道底圖的共用設定（MapLibre + 本機 PMTiles）。
 *
 * 從 MapLibreShelterMap 抽出來，讓其他需要「沒有網路也要看得到地圖」的畫面
 * （例如藍牙求救的位置檢視）能共用同一套底圖，而不是各自複製一份樣式定義。
 *
 * 圖磚檔隨 App 打包（public/maps/taiwan.pmtiles），完全不需要連網。
 */

import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";

export const PMTILES_URL = "/maps/taiwan.pmtiles";

let protocolRegistered = false;

/** 向 MapLibre 註冊 pmtiles 協定；重複呼叫為 no-op */
export function registerPmtilesProtocol() {
  if (protocolRegistered) return;
  const protocol = new Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  protocolRegistered = true;
}

/** 確認打包的圖磚檔真的存在且讀得到——讀不到就得退回純文字的替代畫面 */
export async function isPmtilesAvailable(): Promise<boolean> {
  try {
    const response = await fetch(PMTILES_URL, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

export function getStreetStyle(pmtilesUrl: string = PMTILES_URL): maplibregl.StyleSpecification {
  const pmtilesSource = {
    type: "vector" as const,
    url: `pmtiles://${new URL(pmtilesUrl, window.location.href).toString()}`,
    attribution: "Map data from bundled PMTiles",
  };

  return {
    version: 8,
    sources: {
      protomaps: pmtilesSource,
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#f7f6f2" } },
      {
        id: "earth",
        type: "fill",
        source: "protomaps",
        "source-layer": "earth",
        paint: { "fill-color": "#f7f6f2" },
      },
      {
        id: "landuse",
        type: "fill",
        source: "protomaps",
        "source-layer": "landuse",
        paint: { "fill-color": "#e9f3df", "fill-opacity": 0.72 },
      },
      {
        id: "water",
        type: "fill",
        source: "protomaps",
        "source-layer": "water",
        paint: { "fill-color": "#b8dff4" },
      },
      {
        id: "buildings",
        type: "fill",
        source: "protomaps",
        "source-layer": "buildings",
        minzoom: 14,
        paint: { "fill-color": "#dedbd2", "fill-opacity": 0.75 },
      },
      {
        id: "roads-minor-casing",
        type: "line",
        source: "protomaps",
        "source-layer": "roads",
        paint: { "line-color": "#d4d0c7", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.4, 16, 5] },
      },
      {
        id: "roads-minor",
        type: "line",
        source: "protomaps",
        "source-layer": "roads",
        paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.2, 16, 3.4] },
      },
      {
        id: "roads-major-casing",
        type: "line",
        source: "protomaps",
        "source-layer": "roads",
        filter: ["in", ["get", "kind"], ["literal", ["highway", "major_road"]]],
        paint: { "line-color": "#d5b86f", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.4, 16, 8] },
      },
      {
        id: "roads-major",
        type: "line",
        source: "protomaps",
        "source-layer": "roads",
        filter: ["in", ["get", "kind"], ["literal", ["highway", "major_road"]]],
        paint: { "line-color": "#f7d87a", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.9, 16, 5.8] },
      },
    ],
  };
}
