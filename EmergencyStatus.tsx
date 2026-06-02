import React from 'react';
import { UserStatus } from '../types';

interface Props {
  status: UserStatus;
}

// A pill turns semantic only when its value crosses a threshold — calm by default.
const EmergencyStatus: React.FC<Props> = ({ status }) => {
  const hrHigh = status.heartRate > 100;
  const battLow = status.batteryLevel < 20;
  const located = Boolean(status.location);

  return (
    <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
            hrHigh ? 'bg-critical-soft text-critical-text' : 'bg-surface-2 text-muted'
          }`}
        >
          <i className={`fas fa-heart-pulse text-[11px] ${hrHigh ? 'pulse-soft' : ''}`} aria-hidden="true"></i>
          <span className="font-data font-medium tabular-nums">{status.heartRate}</span>
          <span className="text-[10px]">心率</span>
        </span>

        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
            battLow ? 'bg-high-soft text-high-text' : 'bg-surface-2 text-muted'
          }`}
        >
          <i
            className={`fas ${battLow ? 'fa-battery-quarter' : 'fa-battery-three-quarters'} text-[11px]`}
            aria-hidden="true"
          ></i>
          <span className="font-data font-medium tabular-nums">{Math.round(status.batteryLevel)}%</span>
        </span>
      </div>

      <span className="inline-flex items-center gap-1.5 text-xs text-muted">
        <i
          className={`fas fa-location-dot text-[11px] ${located ? 'text-safe-text' : 'text-muted'}`}
          aria-hidden="true"
        ></i>
        <span className="font-data text-[11px]">
          {located
            ? `${status.location!.lat.toFixed(3)}, ${status.location!.lng.toFixed(3)}`
            : '定位中…'}
        </span>
      </span>
    </div>
  );
};

export default EmergencyStatus;
