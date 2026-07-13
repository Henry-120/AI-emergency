/**
 * GuardiaAI 藍牙模組 - 附近的人列表
 *
 * 純展示元件，不持有自己的狀態。
 *
 * 文案原則：**畫面上不出現任何藍牙術語**。
 * 不顯示 RSSI 數值（-67 dBm 對使用者沒有意義），只顯示遠近。
 */

import React from "react";
import type { NearbyDevice } from "../../services/bluetooth/bluetoothService";

interface Props {
  devices: NearbyDevice[];
  searching: boolean;
  onSelectUser: (device: NearbyDevice) => void;
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

export function NearbyDevicesList({ devices, searching, onSelectUser }: Props) {
  if (devices.length === 0) {
    return (
      <div className="text-center text-slate-400 text-sm py-10">
        {searching ? "正在尋找附近的人…" : "附近目前沒有找到人"}
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

        return (
          <div
            key={device.deviceId}
            className={`rounded-2xl border p-4 ${
              isUser
                ? "bg-amber-500/5 border-amber-500/30"
                : "bg-slate-900/60 border-white/10"
            }`}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {isUser && (
                    <span className="text-[9px] font-bold tracking-wider text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded-full">
                      使用同一個 App
                    </span>
                  )}
                  <div className="text-sm font-semibold text-white truncate">
                    {device.name}
                  </div>
                </div>
                <div className="text-[11px] text-slate-400">
                  {distanceLabel(device.rssi)}
                </div>
              </div>

              {isUser && (
                <button
                  onClick={() => onSelectUser(device)}
                  disabled={!canChat}
                  title={
                    canChat
                      ? undefined
                      : "對方的 App 目前不在畫面上，暫時無法傳訊息"
                  }
                  className="shrink-0 px-4 py-2 bg-amber-500/20 text-amber-200 border border-amber-500/30 rounded-xl text-[13px] font-semibold hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  傳訊息
                </button>
              )}
            </div>

            {/* 訊號強度視覺條 */}
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  isUser ? "bg-amber-400" : "bg-slate-500"
                }`}
                style={{ width: `${strength}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
