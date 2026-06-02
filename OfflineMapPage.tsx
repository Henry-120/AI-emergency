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
    <div className="flex h-screen flex-col overflow-hidden bg-bg text-ink">
      <header className="safe-area-top border-b border-line bg-surface px-4 py-3 shadow-[var(--elev-1)]">
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={onBack}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink transition-colors hover:bg-line"
            aria-label="返回"
          >
            <i className="fas fa-arrow-left text-sm" aria-hidden="true"></i>
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold text-accent">離線地圖</div>
            <h1 className="truncate text-lg font-bold text-ink">{map.map_id}</h1>
          </div>
          <div className="text-right text-[11px] text-muted">
            <div className="font-data">
              {validCount} / {map.tiles_count} 瓦片
            </div>
            <div>縮放 {zoom}</div>
          </div>
        </div>
      </header>

      <main className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <section className="grid grid-cols-2 gap-3 text-[12px]">
          <div className="rounded-xl border border-line bg-surface p-3">
            <div className="text-muted">中心座標</div>
            <div className="mt-1 font-data text-ink">
              {map.center_latitude.toFixed(5)}, {map.center_longitude.toFixed(5)}
            </div>
          </div>
          <div className="rounded-xl border border-line bg-surface p-3">
            <div className="text-muted">涵蓋半徑</div>
            <div className="mt-1 font-data text-ink">{map.radius_km} km</div>
          </div>
        </section>

        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          {map.zoom_levels.map((level) => {
            const count = map.tile_inventory?.[String(level)]?.count || 0;
            return (
              <button
                key={level}
                onClick={() => setZoom(level)}
                className={`min-w-16 rounded-xl border px-3 py-2 text-[12px] font-semibold transition-colors ${
                  zoom === level
                    ? "border-primary bg-primary text-primary-ink"
                    : "border-line bg-surface-2 text-ink"
                }`}
              >
                z{level}
                <span className="ml-1 font-data text-[10px] opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        {hasValidTiles ? (
          <div className="relative mx-auto grid max-w-[720px] grid-cols-5 gap-px overflow-hidden rounded-xl border border-line bg-surface-2">
            {visibleTiles.map((tile) => (
              <div
                key={`${zoom}-${tile.x}-${tile.y}`}
                className="aspect-square bg-surface-2"
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
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary shadow-[var(--elev-2)]"></div>
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-high-soft p-5 text-high-text">
            <div className="font-bold">這包地圖沒有可顯示的有效瓦片</div>
            <p className="mt-2 text-sm leading-relaxed">
              目前磁碟上的瓦片檔案是空檔、錯誤圖，或是 OSM 403
              封鎖提示。請刪除這包地圖，改用允許離線快取的地圖來源後重新下載。
            </p>
          </div>
        )}

        <div className="rounded-xl border border-line bg-surface p-3 text-[12px] text-muted">
          此頁已在 React App 內建，不再開啟後端預覽分頁。之後接 iOS
          本機儲存時，瓦片來源可替換成本機檔案路徑。
        </div>
      </main>
    </div>
  );
}
