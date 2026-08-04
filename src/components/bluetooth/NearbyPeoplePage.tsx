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
  getPeerLastKnownLocation,
  markAllRead,
  recordOutgoing,
  refreshStatusNow,
  subscribeInbox,
} from "../../services/bluetooth/bluetoothInbox";
import { NearbyDevicesList } from "./NearbyDevicesList";
import { ChatPanel } from "./ChatPanel";
import { SosPanel } from "./SosPanel";
import {
  getNearbySosSightings,
  subscribeSosStatus,
  type NearbySosSighting,
} from "../../services/sos/sosRelay";
import { bearingDeg, distanceKm, headingText } from "../../services/offlineSafetyService";
import { LocationMapView } from "./LocationMapView";

interface Props {
  onBack: () => void;
  myLocation: { lat: number; lng: number } | null;
}

/** 一輪掃描結束後，隔多久再自動掃下一輪 */
const RESCAN_DELAY_MS = 2000;

/**
 * 一鍵回覆求救時送出的內容。
 *
 * 訊息本身會自動附上回覆者的位置，所以求救者不只知道「有人看到了」，
 * 還知道對方在哪、離自己多遠。
 */
const QUICK_REPLY_TEXT = "我看到你的求救了，正在前往";

/**
 * 超過這段時間沒再被掃到，就從列表移除。
 *
 * 沒有這道清理，走遠或關掉 App 的人會永遠留在畫面上——在災難情境下，
 * 顯示一個其實已經不在附近的人比顯示不出來更糟。
 */
const DEVICE_STALE_MS = 30_000;

/**
 * 列表的去重 key。
 *
 * **不能直接用 deviceId**：iOS 為了隱私會定期更換藍牙的隨機位址，對掃描端而言
 * 同一支手機換位址後就變成一台全新裝置，同一個人會在列表裡出現好幾次。
 * 識別碼（localId）才是應用層真正穩定的身分，優先用它；掃到的若不是同 App
 * 使用者（沒有 localId），才退回用 deviceId。
 */
function identityKey(device: NearbyDevice): string {
  return device.localId ?? device.deviceId;
}

/**
 * 把求救者的座標換算成「離我多遠、在哪個方向」。
 *
 * 直接顯示經緯度對要去幫忙的人毫無用處——沒有人能看著 (25.0340, 121.5645)
 * 決定要往哪走。距離與方位是純計算，不需要網路也不需要地圖圖磚，
 * 在藍牙求救真正會發生的離線情境下一定算得出來。
 */
function describeDirection(
  from: { lat: number; lng: number } | null,
  to: { lat: number; lng: number } | undefined,
): string | null {
  if (!from || !to) return null;

  const km = distanceKm(from.lat, from.lng, to.lat, to.lng);
  const heading = headingText(bearingDeg(from.lat, from.lng, to.lat, to.lng));
  const distance = km < 1 ? `${Math.round(km * 1000)} 公尺` : `${km.toFixed(1)} 公里`;

  return `${heading}方 ${distance}`;
}

export function NearbyPeoplePage({ onBack, myLocation }: Props) {
  const [status, setStatus] = useState<BluetoothStatus | null>(getCachedStatus());
  const [devices, setDevices] = useState<Map<string, NearbyDevice>>(new Map());
  const [searching, setSearching] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [chatPeer, setChatPeer] = useState<NearbyDevice | null>(null);
  const [showSos, setShowSos] = useState(false);
  const [viewingSos, setViewingSos] = useState<NearbySosSighting | null>(null);
  const [viewingPeer, setViewingPeer] = useState<NearbyDevice | null>(null);
  /** 正在送出一鍵回覆的對象（localId），用來擋重複點擊並顯示送出中 */
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  /** 已經回覆過的求救者，避免重複送出同一句話 */
  const [repliedTo, setRepliedTo] = useState<Set<string>>(new Set());

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

  // ---- 訂閱附近求救的目擊記錄（中繼引擎在 App 層常駐運作，這裡只訂閱 UI 更新） ----
  const [, onSosSightingsChanged] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeSosStatus(onSosSightingsChanged), []);
  const nearbySosSightings = getNearbySosSightings();

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
              setDevices((prev) => {
                const next = new Map(prev);
                // 順手清掉太久沒再出現的，否則 Map 會隨著位址輪替無限長大
                const cutoff = Date.now() - DEVICE_STALE_MS;
                for (const [key, seen] of next) {
                  if (seen.lastSeenAt < cutoff) next.delete(key);
                }
                // 同一個人換過藍牙位址時，這裡會用新的 deviceId 覆蓋掉舊的那筆——
                // 後續連線、傳訊都要走最新的位址，舊的已經連不上了。
                next.set(identityKey(device), device);
                return next;
              });
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
          // 附上原生層回報的原因——只顯示通用訊息的話，權限被拒、藍牙關閉、
          // 原生 plugin 沒註冊全都長一樣，使用者與開發者都無從判斷。
          setErrorMsg(
            "無法讓附近的人看見你。請確認藍牙已開啟並允許權限。" +
              (res.error ? `（${res.error}）` : ""),
          );
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

  // ---- 一鍵回覆求救 ----
  //
  // 按鈕上寫著「我看到了」，按下去就該真的送出去。在緊急情況下還要求對方
  // 先開對話框、再打字、再按送出，是三個多餘的步驟。訊息會自動附上自己的
  // 位置（sendMessage 的既有行為），求救者就知道有人在往他那邊移動、在哪裡。
  const handleQuickReply = useCallback(
    async (peer: NearbyDevice) => {
      const peerId = peer.localId;
      if (!peerId || replyingTo) return;

      setReplyingTo(peerId);
      try {
        const result = await sendMessage(peer.deviceId, QUICK_REPLY_TEXT, myLocation ?? undefined);
        if (result.success && result.message) {
          recordOutgoing(peerId, result.message);
          setRepliedTo((prev) => new Set(prev).add(peerId));
        } else {
          setErrorMsg(`回覆失敗：${result.error ?? "對方可能已離開範圍"}`);
        }
      } finally {
        setReplyingTo(null);
      }
    },
    [myLocation, replyingTo],
  );

  // ---- 別人的求救位置（地圖） ----
  if (viewingSos) {
    return (
      <LocationMapView
        title="求救位置"
        target={viewingSos.location ?? null}
        myLocation={myLocation}
        targetLabel="求救位置"
        details={
          <>
            <div className="text-rose-200 text-sm font-semibold">
              緊急度 {viewingSos.urgencyLevel}/10
              {viewingSos.isTrapped && " · 受困"}
              {viewingSos.battery !== undefined && ` · 對方電量 ${viewingSos.battery}%`}
            </div>
            {viewingSos.locationDetails && (
              <div className="text-slate-300 text-[12px]">{viewingSos.locationDetails}</div>
            )}
            <div className="text-slate-500 text-[11px]">經 {viewingSos.hops} 跳傳到你這裡</div>
          </>
        }
        emptyMessage={
          <>
            這則求救沒有附帶位置。
            <br />
            <span className="text-slate-500">對方送出時可能沒有定位訊號。</span>
          </>
        }
        onBack={() => setViewingSos(null)}
      />
    );
  }

  // ---- 附近某人分享過的位置（地圖） ----
  if (viewingPeer) {
    const known = viewingPeer.localId ? getPeerLastKnownLocation(viewingPeer.localId) : null;
    return (
      <LocationMapView
        title={viewingPeer.localId ?? viewingPeer.name}
        target={known?.location ?? null}
        myLocation={myLocation}
        targetLabel={`${viewingPeer.localId ?? viewingPeer.name} 分享的位置`}
        details={
          known ? (
            <div className="text-slate-300 text-[12px]">
              對方在 {new Date(known.at).toLocaleString("zh-TW")} 分享的位置
            </div>
          ) : undefined
        }
        emptyMessage={
          <>
            還不知道這個人在哪。
            <br />
            <span className="text-slate-500">
              對方傳一則帶位置的訊息給你之後，這裡就會顯示地圖。
            </span>
          </>
        }
        onBack={() => setViewingPeer(null)}
      />
    );
  }

  // ---- 求救頁 ----
  if (showSos) {
    return <SosPanel onBack={() => setShowSos(false)} myLocation={myLocation} />;
  }

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
        <header className="glass-panel safe-area-top px-4 py-3 flex items-center gap-3 border-b border-white/5">
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

  // 太久沒被掃到的就不顯示（走遠、關掉 App 的人）。這裡只是渲染時的過濾，
  // 讓畫面在下一次掃描回來之前就先反映現況；實際的移除在 setDevices 裡進行。
  const cutoff = Date.now() - DEVICE_STALE_MS;
  const deviceList = Array.from(devices.values())
    .filter((d) => d.lastSeenAt >= cutoff)
    .sort((a, b) => b.rssi - a.rssi);
  const isVisible = status?.isAdvertising ?? false;

  return (
    <div className="h-screen flex flex-col bg-[#020617] overflow-hidden">
      <header className="glass-panel safe-area-top px-4 py-3 border-b border-white/5">
        <div className="flex items-center justify-between mb-2">
          <button onClick={onBack} className="text-slate-400 hover:text-white text-sm">
            ← 返回
          </button>
          <div className="text-white font-bold">附近的人</div>
          <button
            onClick={() => setShowSos(true)}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-rose-500/20 text-rose-200 border border-rose-500/30"
          >
            求救
          </button>
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

        {nearbySosSightings.length > 0 && (
          <div className="mb-3 px-3 py-2 bg-rose-900/40 text-rose-100 text-[12px] rounded-xl border border-rose-500/30 space-y-1.5">
            <div className="font-semibold">
              附近有 {nearbySosSightings.length} 人求救,正在幫忙轉發
            </div>
            {nearbySosSightings.map((s) => {
              const direction = describeDirection(myLocation, s.location);
              return (
                <div
                  key={s.msgId}
                  className="text-rose-200/80 rounded-lg px-2 py-1.5 -mx-2 bg-rose-500/10 border border-rose-500/20"
                >
                  <button onClick={() => setViewingSos(s)} className="w-full text-left">
                    {s.fromLocalId && (
                      <div className="font-mono text-rose-100">{s.fromLocalId} 求救</div>
                    )}
                    <div>
                      緊急度 {s.urgencyLevel}/10{s.isTrapped ? " · 受困" : ""}
                      {s.battery !== undefined && ` · 電量 ${s.battery}%`}
                    </div>
                    {direction && <div className="text-rose-100 font-semibold">{direction}</div>}
                    {s.locationDetails && <div>{s.locationDetails}</div>}
                    {s.location && !direction && (
                      // 抓不到自己的定位就無法算方向，退而顯示原始座標讓使用者至少能抄下來轉給救難單位
                      <div className="text-rose-200/60">
                        對方位置 {s.location.lat.toFixed(4)}, {s.location.lng.toFixed(4)}（你目前沒有定位，無法算方向）
                      </div>
                    )}
                    <div className="text-[10px] text-rose-300/60 mt-0.5">
                      {s.location ? "點一下看地圖 →" : "這則求救沒有附帶位置"}
                    </div>
                  </button>

                  {/* 求救者剛好也在附近列表中 → 可以直接回話。少了這個入口，
                      收到求救的人只能乾著急，沒辦法告訴對方「我看到了，我過去」。 */}
                  {(() => {
                    const peer = deviceList.find((d) => d.localId === s.fromLocalId);
                    if (!peer) return null;

                    const sending = replyingTo === s.fromLocalId;
                    const replied = repliedTo.has(s.fromLocalId);

                    return (
                      <div className="mt-1.5 flex gap-1.5">
                        <button
                          onClick={() => void handleQuickReply(peer)}
                          disabled={sending || replied}
                          className="flex-1 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-amber-500/20 text-amber-200 border border-amber-500/30 disabled:opacity-60"
                        >
                          {sending
                            ? "送出中…"
                            : replied
                              ? "✓ 已回覆，對方知道你要過去了"
                              : `回覆「${QUICK_REPLY_TEXT}」`}
                        </button>
                        <button
                          onClick={() => setChatPeer(peer)}
                          className="shrink-0 px-3 py-1.5 rounded-lg text-[12px] bg-slate-700/50 text-slate-200 border border-white/10"
                        >
                          對話
                        </button>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
            <div className="text-[10px] text-rose-300/70">
              傷勢細節與真實身分已加密,只有救援端解得開
            </div>
          </div>
        )}

        <NearbyDevicesList
          devices={deviceList}
          searching={searching}
          onSelectUser={(device) => setChatPeer(device)}
          onShowLocation={(device) => setViewingPeer(device)}
          hasKnownLocation={(device) =>
            Boolean(device.localId && getPeerLastKnownLocation(device.localId))
          }
        />
      </div>
    </div>
  );
}
