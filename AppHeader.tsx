import React from "react";
import { EarthquakeAlert } from "../../services/cwaService";
import { DisasterAnalysis, UserStatus } from "../../types";
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
  onShowBleMessenger,
  onRefreshCwa,
  onShowShelterNavigator,
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
  onShowBleMessenger: () => void;
  onRefreshCwa: () => void;
  onShowShelterNavigator: () => void;
}) {
  const hrHigh = userStatus.heartRate > 100;
  const battLow = userStatus.batteryLevel < 20;

  return (
    <header className="sticky top-0 z-header bg-command text-command-ink shadow-[var(--elev-2)]">
      {/* Row A — identity + live vitals telemetry */}
      <div className="safe-area-top flex items-center justify-between gap-3 px-4 pt-3 pb-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-ink shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
            <i className="fas fa-shield-halved text-sm" aria-hidden="true"></i>
          </div>
          <div className="leading-none">
            <span className="text-lg font-black tracking-tight text-command-ink">
              GUARDIA<span className="font-light text-command-muted">·</span>
              <span className="text-accent">AI</span>
            </span>
            {isOffline && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-high px-2 py-0.5 align-middle text-[10px] font-bold text-white">
                <span className="pulse-soft h-1.5 w-1.5 rounded-full bg-white"></span>
                離線
              </span>
            )}
          </div>
        </div>

        {/* Vitals readout — instrument-style, mono */}
        <div className="flex items-center gap-3 font-data text-[13px] tabular-nums">
          <span className={`inline-flex items-center gap-1.5 ${hrHigh ? "text-critical" : "text-command-ink"}`}>
            <i className={`fas fa-heart-pulse text-[11px] ${hrHigh ? "pulse-soft text-critical" : "text-command-muted"}`} aria-hidden="true"></i>
            {userStatus.heartRate}
          </span>
          <span className={`inline-flex items-center gap-1.5 ${battLow ? "text-high" : "text-command-ink"}`}>
            <i className={`fas ${battLow ? "fa-battery-quarter text-high" : "fa-battery-three-quarters text-command-muted"} text-[11px]`} aria-hidden="true"></i>
            {Math.round(userStatus.batteryLevel)}%
          </span>
        </div>
      </div>

      {/* Alert ribbon — the loudest glanceable line when something is wrong/active */}
      {locationError || cwaError ? (
        <button
          onClick={onRefreshCwa}
          className="flex w-full items-center gap-2 bg-critical px-4 py-2 text-left text-[13px] font-semibold text-white"
        >
          <i className="fas fa-triangle-exclamation shrink-0" aria-hidden="true"></i>
          <span className="flex-1">{locationError || cwaError}</span>
          <i className="fas fa-rotate-right text-[11px] opacity-80" aria-hidden="true"></i>
        </button>
      ) : earthquakeAlert ? (
        <div className="flex w-full items-center gap-2 border-y border-command-line bg-command-2 px-4 py-2 text-[13px]">
          <i className="fas fa-tower-broadcast shrink-0 text-accent" aria-hidden="true"></i>
          <span className="flex-1 text-command-ink">
            CWA 即時 · {earthquakeAlert.location}
            <span className="ml-2 font-data font-bold text-high">M{earthquakeAlert.magnitude.toFixed(1)}</span>
          </span>
          <button onClick={onRefreshCwa} className="text-command-muted transition-colors hover:text-command-ink" aria-label="重新載入 CWA">
            <i className="fas fa-rotate-right text-[11px]" aria-hidden="true"></i>
          </button>
        </div>
      ) : null}

      {/* Row B — location + survival readout · actions (避難包 · 藍牙通訊 · 求救) */}
      <div className="no-scrollbar flex items-center gap-3 border-t border-command-line px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          {userStatus.location && !locationError ? (
            <span className="inline-flex items-center gap-1.5 font-data text-[12px] text-command-muted">
              <i className="fas fa-location-crosshairs text-[11px] text-safe" aria-hidden="true"></i>
              {userStatus.location.lat.toFixed(3)}, {userStatus.location.lng.toFixed(3)}
            </span>
          ) : null}
          {currentAnalysis && (
            <span className="inline-flex items-center gap-2">
              <span className="text-command-ink">
                <SurvivalGauge probability={currentAnalysis.survivalProbability} />
              </span>
              <span className="leading-tight">
                <span className="block text-[10px] font-medium text-command-muted">生存評估</span>
                <span className="font-data text-sm font-bold text-command-ink">
                  {currentAnalysis.survivalProbability}%
                </span>
              </span>
            </span>
          )}
        </div>

        <div className="no-scrollbar ml-auto flex shrink-0 items-center gap-2 overflow-x-auto">
          <button
            onClick={onDownloadOfflineSafetyPack}
            disabled={isDownloadingMap}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-command-line bg-command-2 px-3 text-xs font-semibold text-command-ink transition-colors hover:bg-command-line disabled:opacity-50"
          >
            <i className={`fas ${isDownloadingMap ? "fa-circle-notch fa-spin" : "fa-download"} text-[11px] text-accent`} aria-hidden="true"></i>
            {isDownloadingMap ? "下載中…" : "避難包"}
          </button>
          {offlineSafetyPackReady && (
            <button
              onClick={onShowShelterNavigator}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-command-line bg-command-2 px-3 text-xs font-semibold text-command-ink transition-colors hover:bg-command-line"
            >
              <i className="fas fa-route text-[11px] text-safe" aria-hidden="true"></i>
              避難導航
            </button>
          )}
          <button
            onClick={onShowBleMessenger}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-command-line bg-command-2 px-3 text-xs font-semibold text-command-ink transition-colors hover:bg-command-line"
          >
            <i className="fas fa-tower-cell text-[11px] text-command-muted" aria-hidden="true"></i>
            藍牙通訊
          </button>
          <button
            type="button"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-critical px-3.5 text-sm font-bold text-white transition-transform active:scale-95"
            aria-label="撥打緊急求救電話"
          >
            <i className="fas fa-phone-volume text-[13px]" aria-hidden="true"></i>
            求救
          </button>
        </div>
      </div>
    </header>
  );
}
