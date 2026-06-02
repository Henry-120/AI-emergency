import React from "react";
import {
  headingText,
  OfflineSafetyPack,
  rankShelters,
  Shelter,
} from "../../services/offlineSafetyService";
import { MapLibreShelterMap } from "./MapLibreShelterMap";

export function ShelterNavigatorPage({
  pack,
  location,
  onBack,
}: {
  pack: OfflineSafetyPack;
  location: { lat: number; lng: number } | null;
  onBack: () => void;
}) {
  const rankedShelters = location
    ? rankShelters(pack.shelters, location)
    : pack.shelters;
  const nearest = rankedShelters[0];

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
            <div className="text-[11px] font-semibold text-accent">離線避難導航</div>
            <h1 className="truncate text-lg font-bold text-ink">最近避難所</h1>
          </div>
          <div className="text-right text-[11px] text-muted">
            <div>{pack.shelters.length} 處</div>
            <div>{new Date(pack.downloaded_at).toLocaleDateString()}</div>
          </div>
        </div>
      </header>

      <main className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <MapLibreShelterMap shelters={rankedShelters} location={location} />

        {nearest ? (
          <section className="rounded-xl border border-line bg-safe-soft p-5">
            <div className="inline-flex items-center gap-1.5 text-[12px] font-bold text-safe-text">
              <i className="fas fa-location-arrow text-[11px]" aria-hidden="true"></i>
              建議前往
            </div>
            <h2 className="mt-2 text-2xl font-black text-ink [text-wrap:balance]">
              {nearest.name}
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-line bg-surface p-3">
                <div className="text-[11px] text-muted">距離</div>
                <div className="mt-1 font-data text-2xl font-bold text-safe-text">
                  {nearest.distance_km !== undefined
                    ? `${nearest.distance_km.toFixed(2)} km`
                    : "未知"}
                </div>
              </div>
              <div className="rounded-xl border border-line bg-surface p-3">
                <div className="text-[11px] text-muted">方向</div>
                <div className="mt-1 font-data text-2xl font-bold text-safe-text">
                  {nearest.bearing_deg !== undefined
                    ? `${headingText(nearest.bearing_deg)} ${nearest.bearing_deg.toFixed(0)}°`
                    : "定位中"}
                </div>
              </div>
            </div>
            <div className="mt-4 space-y-2 text-sm text-ink">
              <div>{nearest.address || "無地址資料"}</div>
              <div className="text-muted">
                {[nearest.city, nearest.town, nearest.village]
                  .filter(Boolean)
                  .join(" ")}
              </div>
              {nearest.capacity ? (
                <div className="text-muted">預計收容 {nearest.capacity} 人</div>
              ) : null}
              {nearest.contact_phone ? (
                <a
                  href={`tel:${nearest.contact_phone}`}
                  className="inline-flex items-center gap-2 rounded-xl bg-safe px-4 py-2.5 font-semibold text-white transition-transform active:scale-95"
                >
                  <i className="fas fa-phone" aria-hidden="true"></i>
                  撥打 {nearest.contact_phone}
                </a>
              ) : null}
            </div>
          </section>
        ) : (
          <div className="rounded-xl border border-line bg-high-soft p-5 text-high-text">
            尚未下載附近避難所資料。請連線後回主畫面按「下載避難包」。
          </div>
        )}

        <section className="space-y-2">
          <div className="text-[11px] font-bold tracking-wide text-muted">附近清單</div>
          {rankedShelters.slice(0, 12).map((shelter: Shelter) => (
            <div
              key={shelter.id}
              className="rounded-xl border border-line bg-surface p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-bold text-ink">{shelter.name}</div>
                  <div className="mt-1 text-xs text-muted">
                    {shelter.address ||
                      `${shelter.city || ""}${shelter.town || ""}`}
                  </div>
                </div>
                <div className="shrink-0 text-right font-data text-xs font-semibold text-safe-text">
                  {shelter.distance_km !== undefined
                    ? `${shelter.distance_km.toFixed(2)} km`
                    : ""}
                </div>
              </div>
            </div>
          ))}
        </section>

        <div className="rounded-xl border border-line bg-surface p-3 text-[12px] text-muted">
          離線導航使用直線距離與方位，實際路況、道路阻斷與災害現場請以救災人員指示為準。
        </div>
      </main>
    </div>
  );
}
