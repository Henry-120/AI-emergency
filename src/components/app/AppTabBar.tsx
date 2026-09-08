import React, { useEffect, useState } from "react";

/**
 * 手機底部分頁列（sm 以下顯示；sm 以上功能入口在報頭右上）。
 *
 * 五個分頁固定不變動，避免「有時四個有時五個」造成位置漂移——
 * 使用者靠肌肉記憶按，位置不能跳。條件性的入口（避難導航）收進「更多」。
 *
 * 作用中狀態：頂端一條指示線 + 圖示與文字換成品牌色，
 * 這是 iOS／Android 兩邊都通用的慣例，也是 Facebook 的做法。
 */
type Tab = {
  key: string;
  label: string;
  icon: string;
  onSelect: () => void;
  badge?: number;
};

function TabButton({
  tab,
  active,
}: {
  tab: Tab;
  active?: boolean;
}) {
  return (
    <button
      onClick={tab.onSelect}
      aria-label={
        tab.badge ? `${tab.label}，${tab.badge} 則未讀訊息` : tab.label
      }
      aria-current={active ? "page" : undefined}
      className="relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 transition-transform duration-100 active:scale-90"
    >
      {active && (
        <span
          className="absolute inset-x-3 top-0 h-[3px] rounded-full bg-accent"
          aria-hidden="true"
        />
      )}
      <span className="relative">
        <i
          className={`fas ${tab.icon} text-[19px] ${
            active ? "text-accent" : "text-muted"
          }`}
          aria-hidden="true"
        ></i>
        {tab.badge ? (
          <span className="font-data absolute -right-2.5 -top-1.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full border-2 border-surface bg-critical px-1 text-[10px] font-bold tabular-nums text-white">
            {tab.badge > 99 ? "99+" : tab.badge}
          </span>
        ) : null}
      </span>
      <span
        className={`text-[9px] leading-none ${
          active ? "font-semibold text-accent" : "text-muted"
        }`}
      >
        {tab.label}
      </span>
    </button>
  );
}

export function AppTabBar({
  activeKey,
  onGoHome,
  isDownloadingMap,
  offlineSafetyPackReady,
  nearbyUnreadCount,
  hasAuthUser,
  onDownloadOfflineSafetyPack,
  onShowShelterNavigator,
  onShowNearbyPeople,
  onShowMedicalCard,
  onShowRescueMap,
  onOpenRoomRiskScanner,
  onSimulateSevereEarthquake,
  onLogout,
}: {
  /** 目前所在的分頁；子頁面開啟時由 App 傳入，分頁列因此不會失去焦點。 */
  activeKey: string;
  onGoHome: () => void;
  isDownloadingMap: boolean;
  offlineSafetyPackReady: boolean;
  nearbyUnreadCount: number;
  hasAuthUser: boolean;
  onDownloadOfflineSafetyPack: () => void;
  onShowShelterNavigator: () => void;
  onShowNearbyPeople: () => void;
  onShowMedicalCard: () => void;
  onShowRescueMap: () => void;
  onOpenRoomRiskScanner: () => void;
  onSimulateSevereEarthquake: () => void;
  onLogout: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);

  // 開啟選單時鎖住背景捲動，並支援 Esc 關閉
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  const close = (fn: () => void) => () => {
    setMoreOpen(false);
    fn();
  };

  const tabs: Tab[] = [
    {
      key: "guide",
      label: "求生指引",
      icon: "fa-comment-dots",
      onSelect: () => {
        setMoreOpen(false);
        onGoHome();
      },
    },
    {
      key: "rescue",
      label: "救援地圖",
      icon: "fa-map-location-dot",
      onSelect: onShowRescueMap,
    },
    {
      key: "nearby",
      label: "附近的人",
      icon: "fa-user-group",
      onSelect: onShowNearbyPeople,
      badge: nearbyUnreadCount,
    },
    {
      key: "medical",
      label: "醫療卡",
      icon: "fa-heart-pulse",
      onSelect: onShowMedicalCard,
    },
  ];

  return (
    <>
      {moreOpen && (
        <div
          className="fixed inset-0 z-overlay bg-[var(--overlay)] sm:hidden"
          onClick={() => setMoreOpen(false)}
          aria-hidden="true"
        />
      )}

      {moreOpen && (
        <div
          role="dialog"
          aria-label="更多功能"
          className="fixed inset-x-0 bottom-0 z-modal rounded-t-3xl border-t border-line bg-surface pb-[calc(env(safe-area-inset-bottom)+72px)] shadow-[var(--elev-2)] sm:hidden"
        >
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line" />
          <div className="p-3">
            <button
              onClick={close(onOpenRoomRiskScanner)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors active:bg-surface-2"
            >
              <i className="fas fa-camera w-5 text-center text-accent" aria-hidden="true"></i>
              <span className="text-sm font-semibold text-ink">AR 房間風險掃描</span>
            </button>

            <button
              onClick={close(onDownloadOfflineSafetyPack)}
              disabled={isDownloadingMap}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors active:bg-surface-2 disabled:opacity-40"
            >
              <i
                className={`fas ${isDownloadingMap ? "fa-circle-notch fa-spin" : "fa-download"} w-5 text-center text-accent`}
                aria-hidden="true"
              ></i>
              <span className="text-sm font-semibold text-ink">
                {isDownloadingMap ? "下載中..." : "下載避難包"}
              </span>
            </button>

            {offlineSafetyPackReady && (
              <button
                onClick={close(onShowShelterNavigator)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors active:bg-surface-2"
              >
                <i
                  className="fas fa-diamond-turn-right w-5 text-center text-accent"
                  aria-hidden="true"
                ></i>
                <span className="text-sm font-semibold text-ink">避難導航</span>
              </button>
            )}

            <button
              onClick={close(onSimulateSevereEarthquake)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors active:bg-surface-2"
            >
              <i
                className="fas fa-tower-broadcast w-5 text-center text-critical"
                aria-hidden="true"
              ></i>
              <span className="text-sm font-semibold text-ink">🚨 模擬強震</span>
            </button>

            {hasAuthUser && (
              <button
                onClick={close(onLogout)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors active:bg-surface-2"
              >
                <i
                  className="fas fa-right-from-bracket w-5 text-center text-muted"
                  aria-hidden="true"
                ></i>
                <span className="text-sm font-semibold text-ink">登出</span>
              </button>
            )}
          </div>
        </div>
      )}

      <nav
        aria-label="主要功能"
        className="z-sticky flex shrink-0 items-stretch border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        {tabs.map((t) => (
          <TabButton key={t.key} tab={t} active={t.key === activeKey} />
        ))}
        <button
          onClick={() => setMoreOpen((v) => !v)}
          aria-label="更多功能"
          aria-expanded={moreOpen}
          className="relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 transition-transform duration-100 active:scale-90"
        >
          {moreOpen && (
            <span
              className="absolute inset-x-3 top-0 h-[3px] rounded-full bg-accent"
              aria-hidden="true"
            />
          )}
          <i
            className={`fas fa-bars text-[19px] ${moreOpen ? "text-accent" : "text-muted"}`}
            aria-hidden="true"
          ></i>
          <span
            className={`text-[9px] leading-none ${moreOpen ? "font-semibold text-accent" : "text-muted"}`}
          >
            更多
          </span>
        </button>
      </nav>
    </>
  );
}
