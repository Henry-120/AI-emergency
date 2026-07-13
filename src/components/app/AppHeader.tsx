import React from "react";
import { EarthquakeAlert } from "../../services/cwaService";
import { AuthUser, DisasterAnalysis, UserStatus } from "../../types";
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
  authUser,
  onDownloadOfflineSafetyPack,
  onShowBleMessenger,
  onRefreshCwa,
  onShowShelterNavigator,
  onShowMedicalCard,
  onLogout,
}: {
  currentAnalysis: DisasterAnalysis | null;
  cwaError: string;
  earthquakeAlert: EarthquakeAlert | null;
  isDownloadingMap: boolean;
  isOffline: boolean;
  locationError: string;
  offlineSafetyPackReady: boolean;
  userStatus: UserStatus;
  authUser: AuthUser | null;
  onDownloadOfflineSafetyPack: () => void;
  onShowBleMessenger: () => void;
  onRefreshCwa: () => void;
  onShowShelterNavigator: () => void;
  onShowMedicalCard: () => void;
  onLogout: () => void;
}) {
  return (
    <header className="z-50 shrink-0 shadow-lg safe-area-top bg-[#020617]">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-4 sm:py-3 border-b border-white/5">
        <div className="flex shrink-0 items-center gap-2">
          <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center shadow-lg shadow-amber-500/20">
            <i className="fas fa-shield-alt text-black text-xs"></i>
          </div>
          <span className="font-bold text-lg tracking-tight text-white">
            Guardia<span className="text-amber-500">AI</span>
            {isOffline && (
              <span className="ml-2 text-[10px] bg-red-500/20 text-red-500 px-2 py-0.5 rounded-full">
                OFFLINE
              </span>
            )}
          </span>
        </div>

        <div className="order-3 flex w-full min-w-0 items-center gap-2 overflow-x-auto pb-0.5 no-scrollbar sm:order-none sm:w-auto sm:max-w-[75%] sm:gap-3">
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
            <div className="max-w-[70vw] shrink-0 truncate text-[10px] text-rose-300 bg-rose-500/10 px-3 py-1 rounded-full border border-rose-500/10">
              {locationError}
            </div>
          ) : earthquakeAlert ? (
            <div className="flex items-center gap-2">
              <div className="max-w-[68vw] truncate text-[10px] text-amber-100 bg-slate-800/80 px-3 py-1 rounded-full border border-amber-500/20" title={`CWA：${earthquakeAlert.location} ${earthquakeAlert.magnitude.toFixed(1)} 級`}>
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
            <div className="max-w-[70vw] shrink-0 truncate text-[10px] text-rose-300 bg-rose-500/10 px-3 py-1 rounded-full border border-rose-500/10">
              {cwaError}
            </div>
          ) : userStatus.location ? (
            <div className="shrink-0 text-[10px] text-slate-300 bg-slate-800/80 px-3 py-1 rounded-full border border-white/10">
              目前定位：{userStatus.location.lat.toFixed(4)},{" "}
              {userStatus.location.lng.toFixed(4)}
            </div>
          ) : null}
          <button
            onClick={onDownloadOfflineSafetyPack}
            disabled={isDownloadingMap}
            className="shrink-0 px-3 py-2 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs font-semibold hover:bg-amber-500/20 transition-all disabled:opacity-40"
          >
            {isDownloadingMap ? "下載中..." : "下載避難包"}
          </button>
          {offlineSafetyPackReady && (
            <button
              onClick={onShowShelterNavigator}
              className="shrink-0 px-3 py-2 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 text-xs font-semibold hover:bg-emerald-500/20 transition-all"
            >
              避難導航
            </button>
          )}
          <button
            onClick={onShowBleMessenger}
            className="shrink-0 px-3 py-2 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-100 text-xs font-semibold hover:bg-cyan-500/20 transition-all"
          >
            BLE
          </button>
          <button
            onClick={onShowMedicalCard}
            title="緊急醫療卡"
            className="shrink-0 px-3 py-2 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-200 text-xs font-semibold hover:bg-rose-500/20 transition-all flex items-center gap-1.5"
          >
            <i className="fas fa-notes-medical"></i>
            <span className="hidden sm:inline">醫療卡</span>
          </button>
          {authUser && (
            <div className="flex shrink-0 items-center gap-2">
              <span
                className="text-[11px] text-slate-300 max-w-[80px] truncate hidden sm:inline"
                title={authUser.username}
              >
                {authUser.username}
              </span>
              <button
                onClick={onLogout}
                title="登出"
                className="w-8 h-8 rounded-full bg-slate-700/60 border border-white/10 flex items-center justify-center text-slate-300 hover:text-rose-300 hover:border-rose-500/30 transition-colors"
              >
                <i className="fas fa-right-from-bracket text-xs"></i>
              </button>
            </div>
          )}
          <button className="w-8 h-8 shrink-0 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center active:bg-red-500/30 transition-colors">
            <i className="fas fa-phone-alt text-red-500 text-xs"></i>
          </button>
        </div>
      </div>
      <EmergencyStatus status={userStatus} />
    </header>
  );
}
