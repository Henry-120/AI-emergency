/**
 * GuardiaAI 藍牙模組 - 附近裝置列表元件
 *
 * 純展示元件，不持有自己狀態。
 * 父元件（NearbyPeoplePage）負責掃描、把結果傳進來、處理點擊。
 *
 * 每一列顯示：
 *   - 名稱（同 App 用戶 = localId；其他裝置 = LocalName 或「無名稱」）
 *   - 訊號強度（RSSI → 條狀視覺）
 *   - 估算距離（依 RSSI 粗估近/中/遠）
 *   - GuardiaAI 用戶會多一個「聊天」按鈕
 */

import React from "react";
import type { NearbyDevice } from "../../services/bluetooth/bluetoothService";

interface Props {
  devices: NearbyDevice[];
  /** 點選同 App 用戶 → 進入聊天；非 App 用戶不會觸發此 callback */
  onSelectUser: (device: NearbyDevice) => void;
}

/** RSSI 轉成可讀距離描述（粗略估計，BLE 訊號受牆面影響很大） */
function rssiToDistance(rssi: number): string {
  if (rssi >= -55) return "非常近 (<2m)";
  if (rssi >= -70) return "近 (~5m)";
  if (rssi >= -85) return "中 (~10m)";
  return "遠 (>15m)";
}

/** RSSI 轉成 0–100 的訊號強度百分比（用於進度條視覺） */
function rssiToStrength(rssi: number): number {
  // RSSI 通常在 -100 (極弱) 到 -30 (極強) 之間
  const clamped = Math.max(-100, Math.min(-30, rssi));
  return Math.round(((clamped + 100) / 70) * 100);
}

export function NearbyDevicesList({ devices, onSelectUser }: Props) {
  if (devices.length === 0) {
    return (
      <div className="text-center text-slate-400 text-sm py-8">
        附近沒有掃到任何裝置
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {devices.map((device) => {
        const strength = rssiToStrength(device.rssi);
        const isUser = device.isGuardiaUser;

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
                    <span className="text-[9px] font-bold uppercase tracking-wider text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded-full">
                      GuardiaAI 用戶
                    </span>
                  )}
                  <div className="text-sm font-semibold text-white truncate">
                    {device.name}
                  </div>
                </div>
                <div className="text-[11px] text-slate-400">
                  {rssiToDistance(device.rssi)} · RSSI {device.rssi} dBm
                </div>
              </div>

              {isUser && (
                <button
                  onClick={() => onSelectUser(device)}
                  disabled={!device.localId}
                  title={device.localId ? undefined : "對方未在前景廣播 ID，暫無法建立對話"}
                  className="shrink-0 px-3 py-1.5 bg-amber-500/20 text-amber-200 border border-amber-500/30 rounded-xl text-[12px] font-semibold hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-amber-500/20"
                >
                  💬 聊天
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
