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
              離線避難導航
            </div>
            <h1 className="truncate text-lg font-bold">最近避難所</h1>
          </div>
          <div className="text-right text-[11px] text-slate-400">
            <div>{pack.shelters.length} 處</div>
            <div>{new Date(pack.downloaded_at).toLocaleDateString()}</div>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4 sm:py-4 space-y-3 sm:space-y-4 safe-area-bottom">
        <MapLibreShelterMap shelters={rankedShelters} location={location} />

        {nearest ? (
          <section className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 sm:p-5">
            <div className="text-[11px] uppercase tracking-[0.22em] text-amber-300">
              建議前往
            </div>
            <h2 className="mt-2 break-words text-xl sm:text-2xl font-black text-white">
              {nearest.name}
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-black/20 p-3">
                <div className="text-[11px] text-slate-400">距離</div>
                <div className="mt-1 text-lg sm:text-2xl font-mono font-bold text-amber-300">
                  {nearest.distance_km !== undefined
                    ? `${nearest.distance_km.toFixed(2)} km`
                    : "未知"}
                </div>
              </div>
              <div className="rounded-xl bg-black/20 p-3">
                <div className="text-[11px] text-slate-400">方向</div>
                <div className="mt-1 text-lg sm:text-2xl font-mono font-bold text-amber-300">
                  {nearest.bearing_deg !== undefined
                    ? `${headingText(nearest.bearing_deg)} ${nearest.bearing_deg.toFixed(0)}°`
                    : "定位中"}
                </div>
              </div>
            </div>
            <div className="mt-4 space-y-2 text-sm text-slate-200">
              <div>{nearest.address || "無地址資料"}</div>
              <div className="text-slate-400">
                {[nearest.city, nearest.town, nearest.village]
                  .filter(Boolean)
                  .join(" ")}
              </div>
              {nearest.capacity ? (
                <div className="text-slate-400">
                  預計收容 {nearest.capacity} 人
                </div>
              ) : null}
              {nearest.contact_phone ? (
                <a
                  href={`tel:${nearest.contact_phone}`}
                  className="inline-flex rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-amber-200"
                >
                  撥打 {nearest.contact_phone}
                </a>
              ) : null}
            </div>
          </section>
        ) : (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-5 text-amber-100">
            尚未下載附近避難所資料。請連線後回主畫面按「下載避難包」。
          </div>
        )}

        <section className="space-y-2">
          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
            附近清單
          </div>
          {rankedShelters.slice(0, 12).map((shelter: Shelter) => (
            <div
              key={shelter.id}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-bold text-slate-100">
                    {shelter.name}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {shelter.address ||
                      `${shelter.city || ""}${shelter.town || ""}`}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs text-amber-200">
                  {shelter.distance_km !== undefined
                    ? `${shelter.distance_km.toFixed(2)} km`
                    : ""}
                </div>
              </div>
            </div>
          ))}
        </section>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[12px] text-slate-400">
          離線導航使用直線距離與方位，實際路況、道路阻斷與災害現場請以救災人員指示為準。
        </div>
      </main>
    </div>
  );
}
