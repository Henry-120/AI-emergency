import React, { useEffect, useState } from "react";
import { BACKEND } from "../../services/backend";
import { MapInfo } from "../../services/offlineMapsService";

type TileCoord = { x: number; y: number };

const getTileUrl = (mapId: string, zoom: number, x: number, y: number) =>
  `${BACKEND}/api/offline-maps/${mapId}/tiles/${zoom}/${x}/${y}.png`;

const getPreviewZoom = (map: MapInfo): number => {
  const availableZooms = Object.entries(map.tile_inventory || {})
    .filter(([, info]) => info.count > 0)
    .map(([zoom]) => Number(zoom))
    .sort((a, b) => a - b);

  if (availableZooms.length > 0) {
    return availableZooms[Math.floor(availableZooms.length / 2)];
  }

  return map.zoom_levels[Math.floor(map.zoom_levels.length / 2)] || 14;
};

const getVisibleTiles = (map: MapInfo, zoom: number): TileCoord[] => {
  const inventory = map.tile_inventory?.[String(zoom)];
  const validTiles = inventory?.tiles || [];

  if (validTiles.length === 0) {
    return [];
  }

  const centerX = Math.round(
    ((inventory?.min_x ?? validTiles[0].x) +
      (inventory?.max_x ?? validTiles[0].x)) /
      2,
  );
  const centerY = Math.round(
    ((inventory?.min_y ?? validTiles[0].y) +
      (inventory?.max_y ?? validTiles[0].y)) /
      2,
  );
  const tiles: TileCoord[] = [];

  for (let y = centerY - 2; y <= centerY + 2; y += 1) {
    for (let x = centerX - 2; x <= centerX + 2; x += 1) {
      tiles.push({ x, y });
    }
  }

  return tiles;
};

export function OfflineMapPage({
  map,
  onBack,
}: {
  map: MapInfo;
  onBack: () => void;
}) {
  const [zoom, setZoom] = useState(() => getPreviewZoom(map));
  const validCount = map.valid_tiles_count ?? map.tiles_count;
  const inventory = map.tile_inventory?.[String(zoom)];
  const visibleTiles = getVisibleTiles(map, zoom);
  const hasValidTiles = visibleTiles.length > 0 && (inventory?.count || 0) > 0;

  useEffect(() => {
    setZoom(getPreviewZoom(map));
  }, [map]);

  return (
    <div className="h-[100dvh] min-h-0 flex flex-col bg-[#020617] text-slate-100 overflow-hidden">
      <header className="safe-area-top shrink-0 border-b border-white/10 bg-[#020617] px-3 py-2 sm:px-4 sm:py-3">
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={onBack}
            className="w-11 h-11 shrink-0 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
            aria-label="返回"
          >
            <i className="fas fa-arrow-left text-sm"></i>
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-[0.24em] text-amber-300">
              離線地圖
            </div>
            <h1 className="truncate text-lg font-bold">{map.map_id}</h1>
          </div>
          <div className="text-right text-[11px] text-slate-400">
            <div>
              {validCount} / {map.tiles_count} 瓦片
            </div>
            <div>縮放 {zoom}</div>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4 sm:py-4 space-y-3 sm:space-y-4 safe-area-bottom">
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12px]">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-slate-500">中心座標</div>
            <div className="mt-1 break-all font-mono text-slate-200">
              {map.center_latitude.toFixed(5)}, {map.center_longitude.toFixed(5)}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-slate-500">涵蓋半徑</div>
            <div className="mt-1 font-mono text-slate-200">
              {map.radius_km} km
            </div>
          </div>
        </section>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {map.zoom_levels.map((level) => {
            const count = map.tile_inventory?.[String(level)]?.count || 0;
            return (
              <button
                key={level}
                onClick={() => setZoom(level)}
                className={`min-w-16 rounded-xl border px-3 py-2 text-[12px] font-semibold ${
                  zoom === level
                    ? "border-amber-400 bg-amber-400 text-black"
                    : "border-white/10 bg-white/5 text-slate-300"
                }`}
              >
                z{level}
                <span className="ml-1 text-[10px] opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        {hasValidTiles ? (
          <div className="relative mx-auto grid max-w-[720px] grid-cols-5 gap-px overflow-hidden rounded-xl border border-white/10 bg-slate-800">
            {visibleTiles.map((tile) => (
              <div
                key={`${zoom}-${tile.x}-${tile.y}`}
                className="aspect-square bg-slate-950"
              >
                <img
                  src={getTileUrl(map.map_id, zoom, tile.x, tile.y)}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              </div>
            ))}
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-amber-400 shadow-lg shadow-amber-400/40"></div>
          </div>
        ) : (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-5 text-amber-100">
            <div className="font-bold">這包地圖沒有可顯示的有效瓦片</div>
            <p className="mt-2 text-sm leading-relaxed text-amber-100/75">
              目前磁碟上的瓦片檔案是空檔、錯誤圖，或是 OSM 403
              封鎖提示。請刪除這包地圖，改用允許離線快取的地圖來源後重新下載。
            </p>
          </div>
        )}

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[12px] text-slate-400">
          此頁已在 React App 內建，不再開啟後端預覽分頁。之後接 iOS
          本機儲存時，瓦片來源可替換成本機檔案路徑。
        </div>
      </main>
    </div>
  );
}
