
import React from 'react';
import { UserStatus } from '../types';

interface Props {
  status: UserStatus;
  locationError?: string | null;
  onRetryLocation?: () => void;
}

const EmergencyStatus: React.FC<Props> = ({ status, locationError, onRetryLocation }) => {
  const hasLocation = !!status.location;
  const showError = !hasLocation && !!locationError;

  return (
    <div className="flex min-w-0 items-center justify-between gap-3 w-full px-3 sm:px-4 py-1.5 sm:py-2 bg-slate-900/40 backdrop-blur-md border-b border-white/5">
      <div className="flex shrink-0 items-center gap-3 sm:gap-4">
        <div className="flex items-center gap-1.5">
          <i className={`fas fa-heartbeat text-xs ${status.heartRate > 100 ? 'text-red-500 animate-pulse' : 'text-emerald-500'}`}></i>
          <span className="text-[11px] font-mono font-medium tracking-tighter">{status.heartRate}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <i className={`fas fa-battery-three-quarters text-xs ${status.batteryLevel < 20 ? 'text-red-500' : 'text-amber-500'}`}></i>
          <span className="text-[11px] font-mono font-medium tracking-tighter">{Math.round(status.batteryLevel)}%</span>
        </div>
      </div>

      {showError ? (
        <button
          onClick={onRetryLocation}
          className="flex min-w-0 items-center gap-1.5 text-red-400 hover:text-red-300 active:text-red-200"
          title={locationError || ""}
        >
          <i className="fas fa-location-crosshairs text-[10px]"></i>
          <span className="max-w-[55vw] truncate text-[9px] font-mono underline">
            {locationError} ・ 點此重試
          </span>
        </button>
      ) : (
        <div className={`flex min-w-0 items-center gap-1.5 ${hasLocation ? 'opacity-60' : 'opacity-50 animate-pulse'}`}>
          <i className="fas fa-location-dot text-[10px]"></i>
          <span className="truncate text-[9px] font-mono">
            {hasLocation
              ? `${status.location!.lat.toFixed(2)},${status.location!.lng.toFixed(2)}`
              : '定位中...'}
          </span>
        </div>
      )}
    </div>
  );
};

export default EmergencyStatus;
