import React from "react";
import { EarthquakeAlert } from "../../services/cwaService";
import { AuthUser, DisasterAnalysis, UserStatus } from "../../types";
import EmergencyStatus from "../EmergencyStatus";
import SurvivalGauge from "../SurvivalGauge";

/**
 * 報頭。功能入口改為純圖示，滑鼠移上去才顯示名稱（Facebook 頂部的做法）。
 *
 * 這麼改的理由：原本七顆文字鈕擠成一條橫向捲軸，右邊永遠被切掉，
 * 使用者不捲就不知道還有什麼功能。改成圖示後全部一次看得到。
 *
 * 無障礙：每顆都有 aria-label，讀螢幕軟體唸出來仍然是「附近的人」。
 * 觸控裝置沒有 hover，提示不會出現，但點按直接進功能，不會變成要按兩次。
 */
const ICON_BTN =
  "has-tip relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-[#c8ced6] transition-[background-color,color,transform] duration-100 hover:bg-white/15 hover:text-white focus-visible:bg-white/15 active:scale-90 active:bg-white/25 disabled:opacity-40 disabled:cursor-not-allowed";

function IconButton({
  label,
  icon,
  onClick,
  disabled,
  tone,
  badge,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={badge ? `${label}，${badge} 則未讀訊息` : label}
      className={`${ICON_BTN} ${tone || ""}`}
    >
      <i className={`fas ${icon} text-[17px]`} aria-hidden="true"></i>
      {badge ? (
        <span className="font-data absolute right-1 top-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full border-2 border-[#322e4a] bg-critical px-1 text-[10px] font-bold tabular-nums text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
      <span className="tip">{label}</span>
    </button>
  );
}

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
  onRefreshCwa,
  onShowShelterNavigator,
  onShowNearbyPeople,
  nearbyUnreadCount,
  onShowMedicalCard,
  onShowRescueMap,
  onSimulateSevereEarthquake,
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
  onRefreshCwa: () => void;
  onShowShelterNavigator: () => void;
  /** 藍牙模組：開啟「附近的人」頁面 */
  onShowNearbyPeople: () => void;
  /** 藍牙模組：未讀訊息數。使用者不在該頁面時，仍需知道有人傳訊息來 */
  nearbyUnreadCount: number;
  onShowMedicalCard: () => void;
  onShowRescueMap: () => void;
  onSimulateSevereEarthquake: () => void;
  onLogout: () => void;
}) {
  const statusPill = locationError ? (
    <div className="min-w-0 truncate rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] text-[#f0b9a8]">
      {locationError}
    </div>
  ) : earthquakeAlert ? (
    <button
      onClick={onRefreshCwa}
      title="重新載入 CWA"
      className="flex min-w-0 items-center gap-1.5 truncate rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] text-[#e9eaef] hover:bg-white/20"
    >
      <span className="truncate">
        CWA：{earthquakeAlert.location} {earthquakeAlert.magnitude.toFixed(1)} 級
      </span>
      <span aria-hidden="true">⟳</span>
    </button>
  ) : cwaError ? (
    <div className="min-w-0 truncate rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] text-[#f0b9a8]">
      {cwaError}
    </div>
  ) : userStatus.location ? (
    <div className="min-w-0 truncate rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] text-[#c8ced6]">
      目前定位：{userStatus.location.lat.toFixed(4)},{" "}
      {userStatus.location.lng.toFixed(4)}
    </div>
  ) : null;

  return (
    <header className="grad-chrome z-header shrink-0 shadow-[var(--elev-2)] safe-area-top">
      <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-2 sm:px-4">
        <div className="flex min-w-0 shrink items-center gap-2">
          <div className="grad-03 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
            <i className="fas fa-shield-alt text-xs text-white" aria-hidden="true"></i>
          </div>
          <span className="truncate text-lg font-bold tracking-tight text-white">
            Guardia<span className="text-[#c3b8dc]">AI</span>
          </span>
          {isOffline && (
            <span className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-[10px] text-[#e9eaef]">
              OFFLINE
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3.5">
          {currentAnalysis && (
            <div className="flex items-center gap-1.5">
              <div className="text-right">
                <p className="text-[8px] font-bold uppercase tracking-widest text-[#a9aec0]">
                  生存率
                </p>
                <p className="font-data text-[10px] font-bold text-[#c3b8dc]">
                  {currentAnalysis.survivalProbability}%
                </p>
              </div>
              <SurvivalGauge probability={currentAnalysis.survivalProbability} />
            </div>
          )}

          {/* 電腦版：功能圖示與品牌名、119 同一行靠右。
              手機版隱藏，改由底部分頁列負責。 */}
          <div className="hidden items-center gap-2 sm:flex">
            <IconButton
              label="下載避難包"
              icon={isDownloadingMap ? "fa-circle-notch fa-spin" : "fa-download"}
              onClick={onDownloadOfflineSafetyPack}
              disabled={isDownloadingMap}
            />
            {offlineSafetyPackReady && (
              <IconButton
                label="避難導航"
                icon="fa-diamond-turn-right"
                onClick={onShowShelterNavigator}
              />
            )}
            {/* main 新增：救援地圖（走後端 API，與藍牙無關） */}
            <IconButton
              label="救援地圖"
              icon="fa-map-location-dot"
              onClick={onShowRescueMap}
            />
            {/* 藍牙模組：附近的人入口。未讀訊息以紅點提示——使用者不在該頁面時，
                仍必須知道有人傳訊息給他。 */}
            <IconButton
              label="附近的人"
              icon="fa-user-group"
              onClick={onShowNearbyPeople}
              badge={nearbyUnreadCount}
            />
            <IconButton
              label="醫療卡"
              icon="fa-heart-pulse"
              onClick={onShowMedicalCard}
            />
            <IconButton
              label="模擬強震"
              icon="fa-tower-broadcast"
              onClick={onSimulateSevereEarthquake}
              tone="text-[#f2b4bd] hover:bg-[rgba(178,54,75,0.35)]"
            />
            {authUser && (
              <IconButton
                label="登出"
                icon="fa-right-from-bracket"
                onClick={onLogout}
              />
            )}
          </div>

          {authUser && (
            <span
              className="hidden max-w-[70px] truncate text-[11px] text-[#c8ced6] sm:inline"
              title={authUser.username}
            >
              {authUser.username}
            </span>
          )}

          <a
            href="tel:119"
            aria-label="撥打緊急電話 119"
            className="grad-critical has-tip relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-transform duration-100 active:scale-90"
          >
            <i className="fas fa-phone-alt text-[15px] text-white" aria-hidden="true"></i>
            <span className="tip">撥打 119</span>
          </a>
        </div>
      </div>

      {statusPill && (
        <div className="flex px-3 pb-2 sm:px-4">
          <div className="flex min-w-0 max-w-full">{statusPill}</div>
        </div>
      )}


      <EmergencyStatus status={userStatus} />
    </header>
  );
}
