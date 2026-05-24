import React from "react";
import { Shelter } from "../../services/offlineSafetyService";

export function OfflineShelterMap({
  shelters,
  location,
}: {
  shelters: Shelter[];
  location: { lat: number; lng: number } | null;
}) {
  const plottedShelters = shelters.slice(0, 20);
  const points = [
    ...plottedShelters.map((shelter) => ({ lat: shelter.lat, lon: shelter.lon })),
    ...(location ? [{ lat: location.lat, lon: location.lng }] : []),
  ];

  if (points.length === 0) {
    return null;
  }

  const minLat = Math.min(...points.map((point) => point.lat));
  const maxLat = Math.max(...points.map((point) => point.lat));
  const minLon = Math.min(...points.map((point) => point.lon));
  const maxLon = Math.max(...points.map((point) => point.lon));
  const latPad = Math.max((maxLat - minLat) * 0.2, 0.01);
  const lonPad = Math.max((maxLon - minLon) * 0.2, 0.01);
  const bounds = {
    minLat: minLat - latPad,
    maxLat: maxLat + latPad,
    minLon: minLon - lonPad,
    maxLon: maxLon + lonPad,
  };

  const project = (lat: number, lon: number) => ({
    x: ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * 100,
    y: ((bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat)) * 100,
  });

  const userPoint = location ? project(location.lat, location.lng) : null;
  const nearest = plottedShelters[0];
  const nearestPoint = nearest ? project(nearest.lat, nearest.lon) : null;

  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-amber-300">
            離線地圖
          </div>
          <div className="text-sm text-slate-400">
            內建避難所點位，不使用外部圖磚
          </div>
        </div>
        <div className="text-right text-[11px] text-slate-500">
          <div>{plottedShelters.length} 點</div>
          <div>本機資料</div>
        </div>
      </div>
      <div className="relative aspect-[4/3] w-full">
        <svg viewBox="0 0 100 100" className="h-full w-full">
          <defs>
            <pattern
              id="offline-grid"
              width="10"
              height="10"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 10 0 L 0 0 0 10"
                fill="none"
                stroke="rgba(148,163,184,0.16)"
                strokeWidth="0.35"
              />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="#020617" />
          <rect width="100" height="100" fill="url(#offline-grid)" />
          <path
            d="M8,74 C22,64 31,70 44,58 C60,43 71,47 91,31"
            fill="none"
            stroke="rgba(71,85,105,0.7)"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <path
            d="M15,18 C29,24 38,18 51,26 C65,35 73,30 88,38"
            fill="none"
            stroke="rgba(51,65,85,0.75)"
            strokeWidth="1"
            strokeLinecap="round"
          />

          {nearestPoint && userPoint && (
            <line
              x1={userPoint.x}
              y1={userPoint.y}
              x2={nearestPoint.x}
              y2={nearestPoint.y}
              stroke="#facc15"
              strokeWidth="0.8"
              strokeDasharray="2 1.4"
            />
          )}

          {plottedShelters.map((shelter, index) => {
            const point = project(shelter.lat, shelter.lon);
            return (
              <g key={shelter.id}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={index === 0 ? 2.4 : 1.7}
                  fill={index === 0 ? "#facc15" : "#38bdf8"}
                  stroke="#020617"
                  strokeWidth="0.7"
                />
                {index < 4 && (
                  <text
                    x={Math.min(point.x + 2.5, 84)}
                    y={Math.max(point.y - 1.8, 4)}
                    fill="#e2e8f0"
                    fontSize="3"
                  >
                    {shelter.name}
                  </text>
                )}
              </g>
            );
          })}

          {userPoint && (
            <g>
              <circle
                cx={userPoint.x}
                cy={userPoint.y}
                r="3.1"
                fill="#22c55e"
                stroke="#dcfce7"
                strokeWidth="0.8"
              />
              <text
                x={Math.min(userPoint.x + 3.5, 86)}
                y={Math.max(userPoint.y + 1, 5)}
                fill="#dcfce7"
                fontSize="3.2"
              >
                目前位置
              </text>
            </g>
          )}
        </svg>
      </div>
    </section>
  );
}
