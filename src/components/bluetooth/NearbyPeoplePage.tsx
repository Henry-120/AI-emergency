/**
 * GuardiaAI 藍牙模組 - 主頁面（附近的人）
 *
 * 與舊版的差異：
 *   - 進入頁面就自動持續尋找，不必按「掃描」；掃到一個就即時浮現一個
 *   - 對話歷史來自常駐收件匣（bluetoothInbox），離開頁面訊息不會遺失
 *   - 畫面上不出現任何藍牙術語（廣播 / 掃描 / RSSI / BLE）
 *   - 移除「所有藍牙裝置」模式：掃到耳機、手環對求生沒有用途，只會稀釋列表
 *
 * 按鍵配置照「這個功能實際被用到的當下」決定：
 *   - 「我需要求救」釘在畫面最下緣的拇指區。求救的人正在慌、可能只有一隻手，
 *     不該先捲動列表才找得到入口——所以它不隨內容捲走。
 *   - 「我看到了，我過去」是要邊跑邊按的，給實心綠、寬、56px 高，一按就送。
 *   - 「讓附近的人看見我」是設定一次就不再碰的開關，做成次要樣式，
 *     但開/關狀態必須一眼分辨（不只靠顏色，文字本身就說明現在的狀態）。
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

/**
 * 緊急度 1–10 轉成標籤與樣式。
 *
 * 數字本身對要去幫忙的人沒有意義（「7」是多急？），要幫他翻成能直接判斷的字。
 * 顏色之外一定同時有文字標籤——紅綠色盲也要分得出輕重。
 */
function urgencyBadge(level: number): { label: string; className: string } {
  if (level >= 8) {
    return { label: "危及生命", className: "bg-critical-soft text-critical-text border-critical" };
  }
  if (level >= 5) {
    return { label: "緊急", className: "bg-high-soft text-high-text border-high" };
  }
  return { label: "需要協助", className: "bg-surface-2 text-ink border-line" };
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

  /** 列表上每個人的最後一則訊息。直接由收件匣推導，不另外存一份狀態。 */
  const lastMessageFor = useCallback((device: NearbyDevice) => {
    if (!device.localId) return null;
    const conversation = getConversation(device.localId);
    const last = conversation[conversation.length - 1];
    if (!last) return null;
    return {
      text: last.message.text,
      at: last.message.timestamp,
      incoming: last.direction === "in",
    };
  }, []);

  // ---- 別人的求救位置（地圖） ----
  if (viewingSos) {
    const badge = urgencyBadge(viewingSos.urgencyLevel);
    return (
      <LocationMapView
        title="求救位置"
        target={viewingSos.location ?? null}
        myLocation={myLocation}
        targetLabel="求救位置"
        details={
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-lg border px-2.5 py-1 text-sm font-bold ${badge.className}`}
              >
                {badge.label}
              </span>
              {viewingSos.isTrapped && (
                <span className="rounded-lg border border-critical bg-critical-soft px-2.5 py-1 text-sm font-bold text-critical-text">
                  受困
                </span>
              )}
            </div>
            {viewingSos.locationDetails && (
              <div className="text-base text-ink">{viewingSos.locationDetails}</div>
            )}
            <div className="text-sm text-muted">
              {viewingSos.battery !== undefined && (
                <>對方電量 <span className="font-data">{viewingSos.battery}%</span> · </>
              )}
              經 <span className="font-data">{viewingSos.hops}</span> 跳傳到你這裡
            </div>
          </>
        }
        emptyMessage={
          <>
            這則求救沒有附帶位置。
            <br />
            對方送出時可能沒有定位訊號。
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
            <div className="text-sm text-muted">
              對方在 {new Date(known.at).toLocaleString("zh-TW")} 分享的位置
            </div>
          ) : undefined
        }
        emptyMessage={
          <>
            還不知道這個人在哪。
            <br />
            對方傳一則帶位置的訊息給你之後，這裡就會顯示地圖。
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
      <div className="command-surface flex h-screen flex-col bg-bg text-ink">
        <header className="safe-area-top shrink-0 border-b border-line bg-surface px-3 py-2">
          <div className="flex items-center gap-2">
            <button
              onClick={onBack}
              aria-label="返回"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl text-muted transition-colors active:bg-surface-2 active:text-ink"
            >
              ←
            </button>
            <div className="text-[1.0625rem] font-bold text-ink">附近的人</div>
          </div>
        </header>
        <div className="flex flex-1 items-center justify-center px-8">
          <div className="max-w-[34ch] text-center">
            <p className="text-base leading-relaxed text-ink">這項功能需要在手機 App 中使用。</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              網頁瀏覽器無法使用手機的藍牙。
            </p>
          </div>
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
    <div className="command-surface flex h-screen flex-col overflow-hidden bg-bg text-ink">
      <header className="safe-area-top shrink-0 border-b border-line bg-surface px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            aria-label="返回"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl text-muted transition-colors active:bg-surface-2 active:text-ink"
          >
            ←
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[1.0625rem] font-bold text-ink">附近的人</div>
            <div
              aria-live="polite"
              className="flex items-center gap-1.5 text-sm text-muted"
            >
              {searching && (
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 shrink-0 rounded-full bg-accent pulse-soft"
                />
              )}
              {searching
                ? "持續尋找中"
                : deviceList.length > 0
                  ? `附近有 ${deviceList.length} 人`
                  : "附近目前沒有人"}
            </div>
          </div>
        </div>
      </header>

      {/* 身分與可見性：設定一次就不再碰的東西，壓在一列，不佔畫面主角位置 */}
      <div className="shrink-0 border-b border-line bg-surface px-3 pb-3">
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-muted">
              我的識別碼
            </div>
            <div className="truncate font-data text-base font-bold text-ink">{getLocalId()}</div>
          </div>
          <button
            onClick={handleToggleVisibility}
            aria-pressed={isVisible}
            className={`min-h-[48px] shrink-0 rounded-xl border px-4 text-sm font-bold transition-colors active:opacity-80 ${
              isVisible
                ? "border-safe bg-safe-soft text-safe-text"
                : "border-line bg-surface text-muted"
            }`}
          >
            {isVisible ? "別人看得到我" : "別人看不到我"}
          </button>
        </div>
        {status && !status.isEnabled && (
          <p className="mt-2 text-sm font-medium text-critical-text">
            手機的藍牙未開啟，無法使用此功能
          </p>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {errorMsg && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-critical bg-critical-soft px-3.5 py-2.5"
          >
            <p className="flex-1 text-sm font-medium text-critical-text">{errorMsg}</p>
            <button
              onClick={() => setErrorMsg("")}
              aria-label="關閉這則訊息"
              className="-my-1.5 -mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg text-critical-text"
            >
              ✕
            </button>
          </div>
        )}

        {/* 附近有人求救時，這一段就是整頁的主角，排在所有東西前面 */}
        {nearbySosSightings.length > 0 && (
          <section className="space-y-2.5">
            <h2 className="text-[1.0625rem] font-black text-critical-text">
              附近有 {nearbySosSightings.length} 人求救
            </h2>

            {nearbySosSightings.map((s) => {
              const direction = describeDirection(myLocation, s.location);
              const badge = urgencyBadge(s.urgencyLevel);
              const peer = deviceList.find((d) => d.localId === s.fromLocalId);
              const sending = replyingTo === s.fromLocalId;
              const replied = s.fromLocalId ? repliedTo.has(s.fromLocalId) : false;

              return (
                <div
                  key={s.msgId}
                  className="rounded-2xl border border-critical bg-surface p-4"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-lg border px-2.5 py-1 text-sm font-bold ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                    {s.isTrapped && (
                      <span className="rounded-lg border border-critical bg-critical-soft px-2.5 py-1 text-sm font-bold text-critical-text">
                        受困
                      </span>
                    )}
                  </div>

                  {/* 「往哪走、多遠」是要去幫忙的人唯一真正需要的資訊 */}
                  {direction ? (
                    <div className="text-[1.5rem] font-black leading-tight text-ink">
                      {direction}
                    </div>
                  ) : s.location ? (
                    // 抓不到自己的定位就無法算方向，退而顯示原始座標讓使用者至少能抄下來
                    <div>
                      <div className="font-data text-base font-bold text-ink">
                        {s.location.lat.toFixed(4)}, {s.location.lng.toFixed(4)}
                      </div>
                      <div className="text-sm text-muted">你目前沒有定位，無法算方向</div>
                    </div>
                  ) : (
                    <div className="text-base font-bold text-muted">這則求救沒有附帶位置</div>
                  )}

                  {s.locationDetails && (
                    <div className="mt-1 text-base text-ink">{s.locationDetails}</div>
                  )}

                  <div className="mt-1.5 text-sm text-muted">
                    {s.fromLocalId && (
                      <><span className="font-data">{s.fromLocalId}</span> · </>
                    )}
                    {s.battery !== undefined && (
                      <>電量 <span className="font-data">{s.battery}%</span> · </>
                    )}
                    經 <span className="font-data">{s.hops}</span> 跳傳到你這裡
                  </div>

                  {/* 求救者剛好也在附近列表中 → 可以直接回話。少了這個入口，
                      收到求救的人只能乾著急，沒辦法告訴對方「我看到了，我過去」。 */}
                  {peer && (
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => void handleQuickReply(peer)}
                        disabled={sending || replied}
                        className="min-h-[56px] flex-1 rounded-xl bg-safe px-4 text-[1.0625rem] font-bold text-white transition-colors active:opacity-80 disabled:bg-surface-2 disabled:text-muted"
                      >
                        {sending ? "送出中…" : replied ? "✓ 對方知道你要過去了" : "我看到了，我過去"}
                      </button>
                      <button
                        onClick={() => setChatPeer(peer)}
                        className="min-h-[56px] shrink-0 rounded-xl border border-line bg-surface-2 px-4 text-base font-bold text-ink transition-colors active:opacity-80"
                      >
                        對話
                      </button>
                    </div>
                  )}

                  {s.location && (
                    <button
                      onClick={() => setViewingSos(s)}
                      className="mt-2 min-h-[48px] w-full rounded-xl border border-line bg-surface-2 px-4 text-base font-bold text-ink transition-colors active:opacity-80"
                    >
                      在地圖上看位置
                    </button>
                  )}
                </div>
              );
            })}

            <p className="text-sm text-muted">
              {"你的手機正在幫忙把這些求救轉發出去。傷勢細節與真實身分已加密，只有救援端解得開。"}
            </p>
          </section>
        )}

        <NearbyDevicesList
          devices={deviceList}
          searching={searching}
          onSelectUser={(device) => setChatPeer(device)}
          onShowLocation={(device) => setViewingPeer(device)}
          hasKnownLocation={(device) =>
            Boolean(device.localId && getPeerLastKnownLocation(device.localId))
          }
          lastMessage={lastMessageFor}
        />
      </div>

      {/* 求救入口釘在拇指區。慌張的人不該先捲動列表才找得到它。 */}
      <div className="safe-area-bottom shrink-0 border-t border-line bg-surface px-4 pt-3">
        <button
          onClick={() => setShowSos(true)}
          className="min-h-[64px] w-full rounded-xl bg-critical text-[1.25rem] font-black text-white transition-colors active:opacity-80"
        >
          我需要求救
        </button>
      </div>
    </div>
  );
}
