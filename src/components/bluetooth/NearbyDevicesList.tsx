/**
 * GuardiaAI 藍牙模組 - 附近的人列表
 *
 * 純展示元件，不持有自己的狀態。
 *
 * 文案原則：**畫面上不出現任何藍牙術語**。
 * 不顯示 RSSI 數值（-67 dBm 對使用者沒有意義），只顯示遠近。
 *
 * 按鍵配置照「這個動作實際發生的當下」決定份量：
 *   傳訊息 是這張卡片存在的理由（要聯絡到人），給主要色實心、佔滿寬度、48px；
 *   位置   是輔助查詢，次要樣式、不搶主按鍵的位置。
 */

import React from "react";
import type { NearbyDevice } from "../../services/bluetooth/bluetoothService";

interface Props {
  devices: NearbyDevice[];
  searching: boolean;
  onSelectUser: (device: NearbyDevice) => void;
  /**
   * 在地圖上查看對方位置。
   *
   * 只有「對方傳過帶位置的訊息」時才會有位置可看——藍牙廣播本身不帶座標，
   * 掃到一個人只知道遠近。因此按鈕由 hasKnownLocation 決定是否出現，
   * 不對沒有位置的人顯示一個按了什麼都沒有的入口。
   */
  onShowLocation: (device: NearbyDevice) => void;
  hasKnownLocation: (device: NearbyDevice) => boolean;
  /**
   * 這個人最後一則對話訊息（雙向皆可）。
   *
   * 列表只顯示「誰在附近」的話，使用者無從判斷該點誰——尤其在收到訊息後離開
   * 頁面又回來時，畫面上完全看不出誰找過他。摘要直接由收件匣推導，不另存狀態。
   */
  lastMessage: (device: NearbyDevice) => { text: string; at: number; incoming: boolean } | null;
}

/** 訊號強度轉成人看得懂的距離。BLE 訊號受牆面影響很大，只能表達趨勢。 */
function distanceLabel(rssi: number): string {
  if (rssi >= -55) return "就在旁邊";
  if (rssi >= -70) return "很近";
  if (rssi >= -85) return "有點距離";
  return "較遠";
}

/** 訊號強度轉成 0–100，用於強度條 */
function signalStrength(rssi: number): number {
  const clamped = Math.max(-100, Math.min(-30, rssi));
  return Math.round(((clamped + 100) / 70) * 100);
}

/** 相對時間。災難情境下「3 分鐘前」比 14:32 好判斷得多。 */
function relativeTime(at: number): string {
  const min = Math.floor((Date.now() - at) / 60_000);
  if (min < 1) return "剛剛";
  if (min < 60) return `${min} 分鐘前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小時前`;
  return new Date(at).toLocaleDateString("zh-TW");
}

export function NearbyDevicesList({
  devices,
  searching,
  onSelectUser,
  onShowLocation,
  hasKnownLocation,
  lastMessage,
}: Props) {
  if (devices.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-surface px-5 py-10 text-center">
        <div className="text-base font-bold text-ink">
          {searching ? "正在尋找附近的人…" : "附近目前沒有找到人"}
        </div>
        <p className="mx-auto mt-2 max-w-[34ch] text-sm leading-relaxed text-muted">
          {searching
            ? "找到就會立刻出現在這裡，不用等。"
            : "會持續尋找。也請對方打開「讓附近的人看見我」。"}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {devices.map((device) => {
        const strength = signalStrength(device.rssi);
        const isUser = device.isGuardiaUser;
        // 對方沒在前景廣播識別碼時無法建立對話
        const canChat = isUser && Boolean(device.localId);
        const last = lastMessage(device);
        const knownLocation = hasKnownLocation(device);

        return (
          <div
            // 與列表的去重規則一致：識別碼才是穩定身分，deviceId 會隨 iOS
            // 輪替藍牙位址而改變，拿它當 key 會讓同一個人的卡片被重建
            key={device.localId ?? device.deviceId}
            className="rounded-2xl border border-line bg-surface p-4"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-data text-[1.0625rem] font-bold text-ink">
                  {device.localId ?? device.name}
                </div>
                {isUser && (
                  <div className="mt-1 text-[0.6875rem] font-bold uppercase tracking-wider text-muted">
                    使用同一個 App
                  </div>
                )}
              </div>

              {/* 遠近是這張卡片上最可行動的資訊——決定要不要走過去找他。
                  用 chip 拉出來，不要跟其他小字混在一起。 */}
              <div className="shrink-0 rounded-lg bg-surface-2 px-2.5 py-1 text-sm font-bold text-ink">
                {distanceLabel(device.rssi)}
              </div>
            </div>

            {/* 訊號強度視覺條 */}
            <div
              className="h-1.5 overflow-hidden rounded-full bg-surface-2"
              role="img"
              aria-label={`訊號強度 ${strength}%，${distanceLabel(device.rssi)}`}
            >
              <div
                className="h-full rounded-full bg-accent transition-all duration-200"
                style={{ width: `${strength}%` }}
              />
            </div>

            {last && (
              <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2">
                <div className="truncate text-sm text-ink">
                  <span className="font-bold text-muted">{last.incoming ? "他說：" : "你說："}</span>
                  {last.text}
                </div>
                <div className="mt-0.5 text-[0.6875rem] text-muted">{relativeTime(last.at)}</div>
              </div>
            )}

            {isUser && (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => onSelectUser(device)}
                  disabled={!canChat}
                  title={canChat ? undefined : "對方的 App 目前不在畫面上，暫時無法傳訊息"}
                  className="min-h-[48px] flex-1 rounded-xl bg-primary px-4 text-base font-bold text-primary-ink transition-colors active:opacity-80 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted"
                >
                  {canChat ? "傳訊息" : "對方 App 不在畫面上"}
                </button>
                {knownLocation && (
                  <button
                    onClick={() => onShowLocation(device)}
                    title="在地圖上查看對方分享過的位置"
                    className="min-h-[48px] shrink-0 rounded-xl border border-line bg-surface-2 px-4 text-base font-bold text-ink transition-colors active:opacity-80"
                  >
                    位置
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
