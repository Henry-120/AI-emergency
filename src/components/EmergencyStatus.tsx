
import React from 'react';
import { UserStatus } from '../types';

interface Props {
  status: UserStatus;
}

const EmergencyStatus: React.FC<Props> = ({ status }) => {
  return (
    <div className="flex items-center justify-between w-full px-4 py-2 bg-slate-900/40 backdrop-blur-md border-b border-white/5">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <i className={`fas fa-heartbeat text-xs ${status.heartRate > 100 ? 'text-red-500 animate-pulse' : 'text-emerald-500'}`}></i>
          <span className="text-[11px] font-mono font-medium tracking-tighter">{status.heartRate}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <i className={`fas fa-battery-three-quarters text-xs ${status.batteryLevel < 20 ? 'text-red-500' : 'text-amber-500'}`}></i>
          <span className="text-[11px] font-mono font-medium tracking-tighter">{status.batteryLevel}%</span>
        </div>
      </div>
      
      <div className="flex items-center gap-1.5 opacity-60">
        <i className="fas fa-location-dot text-[10px]"></i>
        <span className="text-[9px] font-mono">
          {status.location ? `${status.location.lat.toFixed(2)},${status.location.lng.toFixed(2)}` : '定位中...'}
        </span>
      </div>
    </div>
  );
};

export default EmergencyStatus;
