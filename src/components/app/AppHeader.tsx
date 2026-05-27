import React from "react";
import { EarthquakeAlert } from "../../services/cwaService";
import { DisasterAnalysis, UserStatus } from "../../types";
import EmergencyStatus from "../EmergencyStatus";
import SurvivalGauge from "../SurvivalGauge";

export function AppHeader({
  currentAnalysis,
  cwaError,
  earthquakeAlert,
  isDownloadingMap,
  isOffline,
  locationError,
  offlineSafetyPackReady,
  userStatus,
  onDownloadOfflineSafetyPack,
  onRefreshCwa,
  onShowShelterNavigator,
  onShowNearbyPeople,
}: {
  currentAnalysis: DisasterAnalysis | null;
  cwaError: string;
  earthquakeAlert: EarthquakeAlert | null;
  isDownloadingMap: boolean;
  isOffline: boolean;
  locationError: string;
  offlineSafetyPackReady: boolean;
  userStatus: UserStatus;
  onDownloadOfflineSafetyPack: () => void;
  onRefreshCwa: () => void;
  onShowShelterNavigator: () => void;
  /** 藍牙模組：開啟「附近的人」頁面 */
  onShowNearbyPeople: () => void;
}) {
  return (
    <header className="z-50 shadow-lg">
      <div className="flex items-center justify-between px-4 py-3 bg-[#020617] border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center shadow-lg shadow-amber-500/20">
            <i className="fas fa-shield-alt text-black text-xs"></i>
          </div>
          <span className="font-bold text-lg tracking-tight">
            Guardia<span className="text-amber-500">AI</span>
            {isOffline && (
              <span className="ml-2 text-[10px] bg-red-500/20 text-red-500 px-2 py-0.5 rounded-full">
                OFFLINE
              </span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-4">
          {currentAnalysis && (
            <div className="flex items-center gap-2 animate-in fade-in duration-500">
              <div className="text-right">
                <p className="text-[8px] text-slate-500 uppercase tracking-widest font-bold">
                  生存率
                </p>
                <p className="text-[10px] font-mono font-bold text-amber-500">
                  {currentAnalysis.survivalProbability}%
                </p>
              </div>
              <SurvivalGauge probability={currentAnalysis.survivalProbability} />
            </div>
          )}
          {locationError ? (
            <div className="text-[10px] text-rose-300 bg-rose-500/10 px-3 py-1 rounded-full border border-rose-500/10">
              {locationError}
            </div>
          ) : earthquakeAlert ? (
            <div className="flex items-center gap-2">
              <div className="text-[10px] text-amber-100 bg-slate-800/80 px-3 py-1 rounded-full border border-amber-500/20">
                CWA：{earthquakeAlert.location}{" "}
                {earthquakeAlert.magnitude.toFixed(1)} 級
              </div>
              <button
                onClick={onRefreshCwa}
                className="text-[10px] text-slate-400 hover:text-amber-400"
                title="重新載入 CWA"
              >
                ⟳
              </button>
            </div>
          ) : cwaError ? (
            <div className="text-[10px] text-rose-300 bg-rose-500/10 px-3 py-1 rounded-full border border-rose-500/10">
              {cwaError}
            </div>
          ) : userStatus.location ? (
            <div className="text-[10px] text-slate-300 bg-slate-800/80 px-3 py-1 rounded-full border border-white/10">
              目前定位：{userStatus.location.lat.toFixed(4)},{" "}
              {userStatus.location.lng.toFixed(4)}
            </div>
          ) : null}
          <button
            onClick={onDownloadOfflineSafetyPack}
            disabled={isDownloadingMap}
            className="px-3 py-2 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs font-semibold hover:bg-amber-500/20 transition-all disabled:opacity-40"
          >
            {isDownloadingMap ? "下載中..." : "下載避難包"}
          </button>
          {offlineSafetyPackReady && (
            <button
              onClick={onShowShelterNavigator}
              className="px-3 py-2 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 text-xs font-semibold hover:bg-emerald-500/20 transition-all"
            >
              避難導航
            </button>
          )}
          {/* 藍牙模組：附近的人入口（同 App 用戶 BLE 互傳訊息 + 位置） */}
          <button
            onClick={onShowNearbyPeople}
            className="px-3 py-2 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-200 text-xs font-semibold hover:bg-sky-500/20 transition-all"
            title="掃描並聯絡附近的 GuardiaAI 使用者"
          >
            附近的人
          </button>
          <button className="w-8 h-8 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center active:bg-red-500/30 transition-colors">
            <i className="fas fa-phone-alt text-red-500 text-xs"></i>
          </button>
        </div>
      </div>
      <EmergencyStatus status={userStatus} />
    </header>
  );
}
