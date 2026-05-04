import React from "react";
import type { EarthquakeAlert } from "../services/cwaService";

interface Props {
  alerts: EarthquakeAlert[];
}

function formatTime(iso: string) {
  if (!iso) return "";
  const d = new Date(iso.replace(" ", "T"));
  if (isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
}

const AlertTicker: React.FC<Props> = ({ alerts }) => {
  if (alerts.length === 0) return null;

  const text = alerts
    .slice(0, 5)
    .map(
      (a) =>
        `${formatTime(a.originTime)} ${a.location} 芮氏 M${a.magnitude.toFixed(1)} 深度 ${a.depth}km`,
    )
    .join("　　•　　");

  return (
    <div className="bg-red-500/10 border-b border-red-500/20 overflow-hidden">
      <div className="flex items-center">
        <div className="flex-shrink-0 px-3 py-1.5 flex items-center gap-1.5 text-red-500 bg-red-500/10">
          <i className="fas fa-bolt text-[10px] animate-pulse"></i>
          <span className="text-[10px] font-bold tracking-widest whitespace-nowrap">
            即時地震
          </span>
        </div>
        <div className="flex-1 overflow-hidden whitespace-nowrap py-1.5">
          <div className="inline-block ticker-anim text-[11px] text-red-100/80 font-mono pl-4">
            {text}　　•　　{text}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AlertTicker;
