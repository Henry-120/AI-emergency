import React from 'react';
import { UserStatus } from '../types';

interface Props {
  status: UserStatus;
  locationError?: string | null;
  onRetryLocation?: () => void;
}

/**
 * 版面回到最初的結構（左側生命徵象、右側定位），
 * 位於報頭的漸層底之上，因此文字固定用淺色。
 */
const EmergencyStatus: React.FC<Props> = ({ status, locationError, onRetryLocation }) => {
  const hasLocation = !!status.location;
  const showError = !hasLocation && !!locationError;

  return (
    <div className="flex min-w-0 items-center justify-between gap-3 w-full px-3 sm:px-4 py-1.5 sm:py-2 bg-black/15 border-b border-white/10">
      <div className="flex shrink-0 items-center gap-3 sm:gap-4">
        <div className="flex items-center gap-1.5">
          <i
            className={`fas fa-heartbeat text-xs ${
              status.heartRate > 100 ? 'text-[#f2b4bd]' : 'text-[#a9dcbf]'
            }`}
          ></i>
          <span className="font-data text-[11px] font-medium tracking-tighter text-[#e9eaef]">
            {status.heartRate}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <i
            className={`fas fa-battery-three-quarters text-xs ${
              status.batteryLevel < 20 ? 'text-[#f2b4bd]' : 'text-[#e0c3a4]'
            }`}
          ></i>
          <span className="font-data text-[11px] font-medium tracking-tighter text-[#e9eaef]">
            {Math.round(status.batteryLevel)}%
          </span>
        </div>
      </div>

      {showError ? (
        <button
          onClick={onRetryLocation}
          className="flex min-w-0 items-center gap-1.5 text-[#f0b9a8] hover:text-white"
          title={locationError || ''}
        >
          <i className="fas fa-location-crosshairs text-[10px]"></i>
          <span className="font-data max-w-[55vw] truncate text-[9px] underline">
            {locationError} ・ 點此重試
          </span>
        </button>
      ) : (
        <div
          className={`flex min-w-0 items-center gap-1.5 text-[#c8ced6] ${
            hasLocation ? 'opacity-70' : 'opacity-60'
          }`}
        >
          <i className="fas fa-location-dot text-[10px]"></i>
          <span className="font-data truncate text-[9px]">
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
