import React, { useEffect, useRef, useState } from "react";
import { EarthquakeAlert } from "../../services/cwaService";
import { AuthUser, DisasterAnalysis, UserStatus } from "../../types";
import EmergencyStatus from "../EmergencyStatus";
import SurvivalGauge from "../SurvivalGauge";
import { ThemePicker } from "./ThemePicker";

/**
 * 報頭。電腦版的功能入口全部收進右上角的 ☰ 選單，報頭只留問候、選單與 119。
 *
 * 119 刻意留在選單外：急難時要一按就撥，不能多藏一層。
 * 「附近的人」的未讀數掛在 ☰ 上——收進選單後，使用者仍必須知道有人傳訊息來。
 *
 * 無障礙：☰ 帶 aria-expanded；選單可按 Esc 或點選單外關閉。
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
  expanded,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: string;
  badge?: number;
  /** 有給值代表這顆鈕開關選單；選單開著時收起提示，免得擋住選單。 */
  expanded?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={badge ? `${label}，${badge} 則未讀訊息` : label}
      aria-haspopup={expanded === undefined ? undefined : "dialog"}
      aria-expanded={expanded}
      className={`${ICON_BTN} ${tone || ""}`}
    >
      <i className={`fas ${icon} text-[17px]`} aria-hidden="true"></i>
      {badge ? (
        <span className="font-data absolute right-1 top-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full border-2 border-[#322e4a] bg-critical px-1 text-[10px] font-bold tabular-nums text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
      {!expanded && <span className="tip">{label}</span>}
    </button>
  );
}

/** ☰ 選單裡的一列，樣式與手機版「更多」一致。 */
function MenuItem({
  label,
  icon,
  onClick,
  disabled,
  iconTone = "text-accent",
  badge,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  iconTone?: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={badge ? `${label}，${badge} 則未讀訊息` : undefined}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 active:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <i className={`fas ${icon} w-5 text-center ${iconTone}`} aria-hidden="true"></i>
      <span className="text-sm font-semibold text-ink">{label}</span>
      {badge ? (
        <span className="font-data ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-critical px-1.5 text-[11px] font-bold tabular-nums text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 選單開著時：按 Esc、或點選單以外的地方就關閉
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menuOpen]);

  const close = (fn: () => void) => () => {
    setMenuOpen(false);
    fn();
  };

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

          {authUser && (
            <span
              className="hidden max-w-[160px] truncate text-[13px] font-medium text-[#e9eaef] sm:inline"
              title={authUser.username}
            >
              Hi, {authUser.username}
            </span>
          )}

          {/* 電腦版：功能全收在 ☰ 選單。手機版隱藏，改由底部分頁列負責。 */}
          <div ref={menuRef} className="relative hidden sm:block">
            <IconButton
              label="選單"
              icon="fa-bars"
              onClick={() => setMenuOpen((open) => !open)}
              badge={nearbyUnreadCount}
              expanded={menuOpen}
            />
            {menuOpen && (
              <div
                role="dialog"
                aria-label="選單"
                className="absolute right-0 top-[calc(100%+8px)] z-modal w-72 rounded-2xl border border-line bg-surface p-2 shadow-[var(--elev-2)]"
              >
                <MenuItem
                  label={isDownloadingMap ? "下載中..." : "下載避難包"}
                  icon={isDownloadingMap ? "fa-circle-notch fa-spin" : "fa-download"}
                  onClick={close(onDownloadOfflineSafetyPack)}
                  disabled={isDownloadingMap}
                />
                {offlineSafetyPackReady && (
                  <MenuItem
                    label="避難導航"
                    icon="fa-diamond-turn-right"
                    onClick={close(onShowShelterNavigator)}
                  />
                )}
                <MenuItem
                  label="救援地圖"
                  icon="fa-map-location-dot"
                  onClick={close(onShowRescueMap)}
                />
                <MenuItem
                  label="附近的人"
                  icon="fa-user-group"
                  onClick={close(onShowNearbyPeople)}
                  badge={nearbyUnreadCount}
                />
                <MenuItem
                  label="醫療卡"
                  icon="fa-heart-pulse"
                  onClick={close(onShowMedicalCard)}
                />
                <MenuItem
                  label="模擬強震"
                  icon="fa-tower-broadcast"
                  onClick={close(onSimulateSevereEarthquake)}
                  iconTone="text-critical"
                />
                <div className="my-1 border-t border-line" />
                <ThemePicker />
                {authUser && (
                  <>
                    <div className="my-1 border-t border-line" />
                    <MenuItem
                      label="登出"
                      icon="fa-right-from-bracket"
                      onClick={close(onLogout)}
                      iconTone="text-muted"
                    />
                  </>
                )}
              </div>
            )}
          </div>

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
