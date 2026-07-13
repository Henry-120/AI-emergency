/**
 * GuardiaAI 藍牙模組 - 主頁面（附近的人）
 *
 * 與舊版的差異：
 *   - 進入頁面就自動持續尋找，不必按「掃描」；掃到一個就即時浮現一個
 *   - 對話歷史來自常駐收件匣（bluetoothInbox），離開頁面訊息不會遺失
 *   - 畫面上不出現任何藍牙術語（廣播 / 掃描 / RSSI / BLE）
 *   - 移除「所有藍牙裝置」模式：掃到耳機、手環對求生沒有用途，只會稀釋列表
 */

import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  disconnectAllPeers,
  getLocalId,
  initBluetooth,
  scanNearby,
  sendMessage,
  startBroadcasting,
  stopBroadcasting,
  stopScan,
  type BluetoothStatus,
  type NearbyDevice,
} from "../../services/bluetooth/bluetoothService";
import {
  getCachedStatus,
  getConversation,
  markAllRead,
  recordOutgoing,
  refreshStatusNow,
  subscribeInbox,
} from "../../services/bluetooth/bluetoothInbox";
import { NearbyDevicesList } from "./NearbyDevicesList";
import { ChatPanel } from "./ChatPanel";

interface Props {
  onBack: () => void;
  myLocation: { lat: number; lng: number } | null;
}

/** 一輪掃描結束後，隔多久再自動掃下一輪 */
const RESCAN_DELAY_MS = 2000;

export function NearbyPeoplePage({ onBack, myLocation }: Props) {
  const [status, setStatus] = useState<BluetoothStatus | null>(getCachedStatus());
  const [devices, setDevices] = useState<Map<string, NearbyDevice>>(new Map());
  const [searching, setSearching] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [chatPeer, setChatPeer] = useState<NearbyDevice | null>(null);

  /** 收件匣變動時強制重繪（對話內容直接從收件匣讀，不另存一份 state） */
  const [, onInboxChanged] = useReducer((n: number) => n + 1, 0);

  /** 控制自動尋找迴圈的中止器 */
  const abortRef = useRef<AbortController | null>(null);
  /** 元件是否還活著——非同步迴圈不能對已卸載的元件 setState */
  const aliveRef = useRef(true);

  // ---- 訂閱常駐收件匣（收訊本身在 App 層常駐，這裡只訂閱 UI 更新） ----
  useEffect(() => {
    markAllRead();
    const unsub = subscribeInbox(() => {
      onInboxChanged();
      setStatus(getCachedStatus());
    });
    return unsub;
  }, []);

  // ---- 進入頁面即自動、持續地尋找附近的人 ----
  useEffect(() => {
    aliveRef.current = true;

    (async () => {
      try {
        await initBluetooth();
        refreshStatusNow();
      } catch (err) {
        console.error("[NearbyPeoplePage] 藍牙啟動失敗", err);
        if (aliveRef.current) {
          setErrorMsg("無法啟動附近功能，請確認手機的藍牙已開啟。");
        }
        return;
      }

      // 一輪接一輪地尋找，直到使用者離開頁面
      while (aliveRef.current) {
        const controller = new AbortController();
        abortRef.current = controller;

        setSearching(true);
        try {
          await scanNearby({
            onlyGuardiaUsers: true,
            signal: controller.signal,
            // 掃到一台就即時加進列表，不必等整輪結束
            onDevice: (device) => {
              if (!aliveRef.current) return;
              setDevices((prev) => new Map(prev).set(device.deviceId, device));
            },
          });
        } catch (err) {
          if (aliveRef.current) {
            setErrorMsg("尋找附近的人時發生問題：" + String(err));
          }
        }

        if (!aliveRef.current) break;
        setSearching(false);

        // 稍作間隔再找下一輪，避免藍牙持續滿載耗電
        await new Promise((r) => setTimeout(r, RESCAN_DELAY_MS));
      }
    })();

    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
      stopScan();
      // 離開功能時斷開所有連線，不要讓連線池懸著
      void disconnectAllPeers();
    };
  }, []);

  // ---- 切換「讓附近的人看見我」 ----
  const handleToggleVisibility = async () => {
    if (!status) return;

    try {
      if (status.isAdvertising) {
        await stopBroadcasting();
      } else {
        const res = await startBroadcasting();
        if (!res.success) {
          setErrorMsg("無法讓附近的人看見你。請確認藍牙已開啟並允許權限。");
        }
      }
    } catch (err) {
      setErrorMsg("切換失敗：" + String(err));
    }

    refreshStatusNow();
  };

  // ---- 傳訊息 ----
  const handleSend = useCallback(
    async (text: string) => {
      if (!chatPeer?.localId) {
        return { success: false, error: "對方的 App 不在畫面上，暫時無法傳訊息" };
      }

      const result = await sendMessage(chatPeer.deviceId, text, myLocation ?? undefined);

      // 自己傳出的訊息也寫進常駐收件匣，離開頁面後對話才不會只剩一半
      if (result.success && result.message) {
        recordOutgoing(chatPeer.localId, result.message);
      }

      return { success: result.success, error: result.error };
    },
    [chatPeer, myLocation],
  );

  // ---- 對話頁 ----
  if (chatPeer) {
    const conversation = chatPeer.localId ? getConversation(chatPeer.localId) : [];
    return (
      <ChatPanel
        peer={chatPeer}
        records={conversation}
        hasLocation={Boolean(myLocation)}
        onSend={handleSend}
        onBack={() => setChatPeer(null)}
      />
    );
  }

  // 非原生環境（瀏覽器）完全無法使用：iOS Safari 不支援 Web Bluetooth，連掃描都不行。
  // 舊版寫「僅能掃描」是錯的，會誤導使用者以為功能還有一半能用。
  if (status && !status.isNative) {
    return (
      <div className="h-screen flex flex-col bg-[#020617]">
        <header className="glass-panel px-4 py-3 flex items-center gap-3 border-b border-white/5">
          <button onClick={onBack} className="text-slate-400 hover:text-white text-sm">
            ← 返回
          </button>
          <div className="text-white font-bold">附近的人</div>
        </header>
        <div className="flex-1 flex items-center justify-center px-8">
          <p className="text-center text-slate-300 text-sm leading-relaxed">
            這項功能需要在手機 App 中使用。
            <br />
            <span className="text-slate-500">網頁瀏覽器無法使用手機的藍牙。</span>
          </p>
        </div>
      </div>
    );
  }

  const deviceList = Array.from(devices.values()).sort((a, b) => b.rssi - a.rssi);
  const isVisible = status?.isAdvertising ?? false;

  return (
    <div className="h-screen flex flex-col bg-[#020617] overflow-hidden">
      <header className="glass-panel px-4 py-3 border-b border-white/5">
        <div className="flex items-center justify-between mb-2">
          <button onClick={onBack} className="text-slate-400 hover:text-white text-sm">
            ← 返回
          </button>
          <div className="text-white font-bold">附近的人</div>
          <div className="w-12" />
        </div>

        <div className="flex items-center justify-between gap-3 bg-slate-900/60 border border-white/10 rounded-xl px-3 py-2">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-slate-400">我的識別碼</div>
            <div className="text-sm font-mono text-amber-300">{getLocalId()}</div>
            {status && !status.isEnabled && (
              <div className="text-[11px] text-rose-300 mt-1">
                手機的藍牙未開啟，無法使用此功能
              </div>
            )}
          </div>
          <button
            onClick={handleToggleVisibility}
            className={`shrink-0 px-4 py-2.5 rounded-xl text-[13px] font-semibold border ${
              isVisible
                ? "bg-rose-500/20 text-rose-200 border-rose-500/30"
                : "bg-emerald-500/20 text-emerald-200 border-emerald-500/30"
            }`}
          >
            {isVisible ? "停止讓別人看見我" : "讓附近的人看見我"}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {searching && (
          <div className="flex items-center gap-2 mb-3 text-[12px] text-slate-400">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            正在尋找附近的人…
          </div>
        )}

        {errorMsg && (
          <div className="mb-3 px-3 py-2 bg-rose-900/30 text-rose-200 text-[12px] rounded-xl border border-rose-500/20">
            {errorMsg}
          </div>
        )}

        <NearbyDevicesList
          devices={deviceList}
          searching={searching}
          onSelectUser={(device) => setChatPeer(device)}
        />
      </div>
    </div>
  );
}
