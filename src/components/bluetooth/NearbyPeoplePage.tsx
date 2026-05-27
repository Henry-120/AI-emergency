/**
 * GuardiaAI 藍牙模組 - 主頁面（附近的人）
 *
 * 整個藍牙功能的入口，職責：
 *   1. 初始化藍牙（首次進入）
 *   2. 提供「開始/停止 廣播自己」開關
 *   3. 提供「同 App 用戶 / 所有 BLE 裝置」切換
 *   4. 提供「掃描」按鈕、顯示掃描結果（用 NearbyDevicesList）
 *   5. 點選同 App 用戶 → 進入 ChatPanel
 *   6. 持有所有對話訊息（Map<fromLocalId, ChatItem[]>），訂閱原生收訊事件
 *
 * 父元件（App.tsx）只需傳入 onBack 與目前 GPS 位置即可。
 */

import React, { useEffect, useState, useCallback } from "react";
import {
  initBluetooth,
  getStatus,
  startBroadcasting,
  stopBroadcasting,
  scanNearby,
  sendMessage,
  subscribeMessages,
  getLocalId,
  type BluetoothStatus,
  type NearbyDevice,
  type IncomingMessage,
} from "../../services/bluetooth/bluetoothService";
import { NearbyDevicesList } from "./NearbyDevicesList";
import { ChatPanel, type ChatItem } from "./ChatPanel";

interface Props {
  onBack: () => void;
  myLocation: { lat: number; lng: number } | null;
}

export function NearbyPeoplePage({ onBack, myLocation }: Props) {
  const [status, setStatus] = useState<BluetoothStatus | null>(null);
  const [onlyGuardiaUsers, setOnlyGuardiaUsers] = useState(true);
  const [devices, setDevices] = useState<NearbyDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string>("");

  /** 進入聊天的對方裝置；null = 顯示列表頁 */
  const [chatPeer, setChatPeer] = useState<NearbyDevice | null>(null);

  /**
   * 所有對話訊息，以對方的 localId 為 key。
   * 寫入時：自己傳出 = 用 chatPeer.localId；對方傳來 = 用 msg.from。
   * 兩者皆為對方廣播宣告的短 ID，保證對得起來。
   */
  const [chatHistory, setChatHistory] = useState<Map<string, ChatItem[]>>(new Map());

  // ---- 初始化：拉狀態 + 訂閱收訊 ----
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    (async () => {
      try {
        await initBluetooth();
        const s = await getStatus();
        setStatus(s);

        unsubscribe = await subscribeMessages((msg: IncomingMessage) => {
          // 把收到的訊息附加到對方 from 的對話歷史
          setChatHistory((prev) => {
            const next = new Map(prev);
            const list = next.get(msg.from) ?? [];
            next.set(msg.from, [...list, { direction: "in", message: msg }]);
            return next;
          });
        });
      } catch (err) {
        console.error("[NearbyPeoplePage] 初始化失敗", err);
        setScanError("藍牙初始化失敗：" + String(err));
      }
    })();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // ---- 重新整理狀態（廣播 on/off 後呼叫一次） ----
  const refreshStatus = useCallback(async () => {
    const s = await getStatus();
    setStatus(s);
  }, []);

  // ---- 切換廣播自己 ----
  const handleToggleBroadcast = async () => {
    if (!status) return;
    if (status.isAdvertising) {
      await stopBroadcasting();
    } else {
      const res = await startBroadcasting();
      if (!res.success) {
        setScanError("廣播啟動失敗。請確認藍牙已開啟並允許權限。");
      }
    }
    await refreshStatus();
  };

  // ---- 掃描附近 ----
  const handleScan = async () => {
    setScanning(true);
    setScanError("");
    try {
      const result = await scanNearby(onlyGuardiaUsers);
      setDevices(result);
    } catch (err) {
      setScanError("掃描失敗：" + String(err));
    } finally {
      setScanning(false);
    }
  };

  // ---- 傳訊息（由 ChatPanel 呼叫） ----
  const handleSendInChat = async (text: string) => {
    if (!chatPeer) return { success: false, error: "未選擇對象" };
    // 對話歷史以對方的 localId 為 key；沒有 localId 表示對方 App 未在前景廣播，無法聊天
    if (!chatPeer.localId) {
      return { success: false, error: "對方未提供識別 ID，無法建立對話" };
    }

    const result = await sendMessage(
      chatPeer.deviceId,
      text,
      myLocation ?? undefined,
    );

    if (result.success) {
      // 把自己傳出的訊息也記到對話歷史（送達不代表對方一定有收到，但 BLE write 成功通常代表已寫入）
      const peerKey = chatPeer.localId;
      setChatHistory((prev) => {
        const next = new Map(prev);
        const list = next.get(peerKey) ?? [];
        next.set(peerKey, [
          ...list,
          {
            direction: "out",
            message: {
              from: getLocalId(),
              text,
              location: myLocation ?? undefined,
              timestamp: Date.now(),
            },
          },
        ]);
        return next;
      });
    }

    return result;
  };

  // ---- 進入聊天頁 ----
  if (chatPeer) {
    return (
      <ChatPanel
        peer={chatPeer}
        messages={chatPeer.localId ? chatHistory.get(chatPeer.localId) ?? [] : []}
        myLocation={myLocation}
        onSend={handleSendInChat}
        onBack={() => setChatPeer(null)}
      />
    );
  }

  // ---- 列表頁 ----
  return (
    <div className="h-screen flex flex-col bg-[#020617] overflow-hidden">
      {/* 標頭 */}
      <header className="glass-panel px-4 py-3 border-b border-white/5">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={onBack}
            className="text-slate-400 hover:text-white text-sm"
          >
            ← 返回
          </button>
          <div className="text-white font-bold">附近的人</div>
          <div className="w-12" />
        </div>

        {/* 廣播狀態與切換 */}
        {status && (
          <div className="flex items-center justify-between bg-slate-900/60 border border-white/10 rounded-xl px-3 py-2">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-slate-400 uppercase tracking-wider">
                我的代號
              </div>
              <div className="text-sm font-mono text-amber-300">
                {getLocalId() || "尚未廣播"}
              </div>
              {!status.isNative && (
                <div className="text-[10px] text-rose-300 mt-1">
                  ⚠️ 瀏覽器環境無法廣播自己，僅能掃描
                </div>
              )}
              {status.isNative && !status.isEnabled && (
                <div className="text-[10px] text-rose-300 mt-1">
                  ⚠️ 裝置藍牙未開啟
                </div>
              )}
            </div>
            <button
              onClick={handleToggleBroadcast}
              disabled={!status.isNative}
              className={`shrink-0 px-3 py-2 rounded-xl text-[12px] font-semibold border ${
                status.isAdvertising
                  ? "bg-rose-500/20 text-rose-200 border-rose-500/30"
                  : "bg-emerald-500/20 text-emerald-200 border-emerald-500/30"
              } disabled:opacity-40`}
            >
              {status.isAdvertising ? "停止廣播" : "開始廣播"}
            </button>
          </div>
        )}
      </header>

      {/* 內容區 */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* 掃描範圍切換 */}
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setOnlyGuardiaUsers(true)}
            className={`flex-1 py-2 rounded-xl text-[12px] font-semibold border ${
              onlyGuardiaUsers
                ? "bg-amber-500/20 text-amber-200 border-amber-500/40"
                : "bg-slate-900/60 text-slate-400 border-white/10"
            }`}
          >
            只看 GuardiaAI 用戶
          </button>
          <button
            onClick={() => setOnlyGuardiaUsers(false)}
            className={`flex-1 py-2 rounded-xl text-[12px] font-semibold border ${
              !onlyGuardiaUsers
                ? "bg-amber-500/20 text-amber-200 border-amber-500/40"
                : "bg-slate-900/60 text-slate-400 border-white/10"
            }`}
          >
            所有藍牙裝置
          </button>
        </div>

        <button
          onClick={handleScan}
          disabled={scanning}
          className="w-full py-3 mb-4 bg-amber-500/20 text-amber-100 border border-amber-500/40 rounded-xl font-semibold disabled:opacity-40"
        >
          {scanning ? "掃描中... (約 8 秒)" : "🔍 掃描附近"}
        </button>

        {scanError && (
          <div className="mb-3 px-3 py-2 bg-rose-900/30 text-rose-200 text-[12px] rounded-xl border border-rose-500/20">
            {scanError}
          </div>
        )}

        <NearbyDevicesList
          devices={devices}
          onSelectUser={(device) => setChatPeer(device)}
        />
      </div>
    </div>
  );
}
