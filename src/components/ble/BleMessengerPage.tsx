import React, { FormEvent, useEffect, useState } from "react";
import type { BLEMessage, NearbyUser } from "../../types/ble";
import {
  connectGuardianDevice,
  disconnectGuardianDevice,
  initializeBleMessenger,
  onBleMessage,
  onNearbyUsersChanged,
  sendGuardianMessage,
  startGuardianAdvertising,
  startGuardianScan,
  stopGuardianScan,
} from "../../services/bleMessengerService";

export function BleMessengerPage({ onBack }: { onBack: () => void }) {
  const [nearbyUsers, setNearbyUsers] = useState<NearbyUser[]>([]);
  const [messages, setMessages] = useState<BLEMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("尚未啟動 BLE");
  const [isScanning, setIsScanning] = useState(false);
  const [connectedId, setConnectedId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    onNearbyUsersChanged(setNearbyUsers);
    onBleMessage((message) => {
      setMessages((prev) => [...prev, message]);
    });

    return () => {
      onNearbyUsersChanged(null);
      onBleMessage(null);
      stopGuardianScan().catch(() => {});
    };
  }, []);

  const handleInitialize = async () => {
    try {
      setStatus("正在初始化藍牙...");
      await initializeBleMessenger();
      setStatus("BLE 已就緒");
    } catch (error) {
      setStatus(getErrorMessage(error));
    }
  };

  const handleScan = async () => {
    try {
      setStatus("正在掃描 Guardian BLE 裝置...");
      setIsScanning(true);
      await startGuardianScan();
    } catch (error) {
      setIsScanning(false);
      setStatus(getErrorMessage(error));
    }
  };

  const handleStopScan = async () => {
    await stopGuardianScan();
    setIsScanning(false);
    setStatus("已停止掃描");
  };

  const handleConnect = async (user: NearbyUser) => {
    try {
      setStatus(`正在連線 ${user.nickname}...`);
      await connectGuardianDevice(user.id);
      setConnectedId(user.id);
      setStatus(`已連線 ${user.nickname}`);
    } catch (error) {
      setStatus(getErrorMessage(error));
    }
  };

  const handleDisconnect = async () => {
    await disconnectGuardianDevice();
    setConnectedId(null);
    setStatus("已中斷 BLE 連線");
  };

  const handleAdvertise = async () => {
    try {
      await startGuardianAdvertising();
    } catch (error) {
      setStatus(getErrorMessage(error));
    }
  };

  const handleSend = async (event: FormEvent) => {
    event.preventDefault();
    const content = input.trim();
    if (!content) return;

    try {
      setIsSending(true);
      await sendGuardianMessage(content);
      setInput("");
    } catch (error) {
      setStatus(getErrorMessage(error));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="h-[100dvh] min-h-0 overflow-hidden bg-[#020617] text-slate-100 flex flex-col">
      <header className="safe-area-top shrink-0 px-3 py-2 sm:px-5 sm:py-4 border-b border-white/10 flex items-center gap-3">
        <button
          onClick={onBack}
          className="w-10 h-10 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10"
        >
          ←
        </button>
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-amber-300 font-bold">
            BLE Mesh
          </p>
          <h1 className="text-xl font-black">附近互助通訊</h1>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain grid grid-cols-1 lg:overflow-hidden lg:grid-cols-[360px_1fr]">
        <aside className="border-b lg:border-b-0 lg:border-r border-white/10 p-3 sm:p-4 space-y-3 sm:space-y-4">
          <div className="rounded-lg border border-white/10 bg-slate-950/70 p-4">
            <p className="text-xs text-slate-400 mb-3">{status}</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleInitialize}
                className="min-h-11 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold"
              >
                初始化
              </button>
              <button
                onClick={isScanning ? handleStopScan : handleScan}
                className="min-h-11 px-3 py-2 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-100 text-xs font-bold hover:bg-amber-500/25"
              >
                {isScanning ? "停止掃描" : "掃描"}
              </button>
              <button
                onClick={handleAdvertise}
                className="min-h-11 px-3 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/25 text-cyan-100 text-xs font-bold hover:bg-cyan-500/20"
              >
                廣播
              </button>
              <button
                onClick={handleDisconnect}
                disabled={!connectedId}
                className="min-h-11 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-100 text-xs font-bold hover:bg-rose-500/20 disabled:opacity-40"
              >
                中斷
              </button>
            </div>
          </div>

          <section>
            <h2 className="text-xs font-bold text-slate-400 mb-2">
              附近裝置
            </h2>
            <div className="space-y-2">
              {nearbyUsers.length === 0 ? (
                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-500">
                  尚未找到 Guardian BLE 裝置
                </div>
              ) : (
                nearbyUsers.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => handleConnect(user)}
                    className="w-full text-left rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-bold text-sm">{user.nickname}</p>
                      <span className="text-[10px] text-amber-200">
                        {user.distance}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      RSSI {user.rssi} · {user.connectionState}
                    </p>
                  </button>
                ))
              )}
            </div>
          </section>
        </aside>

        <section className="min-h-[48dvh] lg:min-h-0 flex flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5 space-y-3">
            {messages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                連線到相容的 Guardian BLE 裝置後即可傳送訊息
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-[88%] sm:max-w-[78%] break-words rounded-lg px-4 py-3 ${
                    message.isMine
                      ? "ml-auto bg-amber-500 text-black"
                      : "bg-slate-900 border border-white/10"
                  }`}
                >
                  <p className="text-sm font-semibold">{message.content}</p>
                  <p
                    className={`text-[10px] mt-1 ${
                      message.isMine ? "text-black/60" : "text-slate-500"
                    }`}
                  >
                    {message.timestamp.toLocaleTimeString()}
                  </p>
                </div>
              ))
            )}
          </div>

          <form
            onSubmit={handleSend}
            className="safe-area-bottom shrink-0 border-t border-white/10 p-3 sm:p-4 flex items-center gap-2 sm:gap-3"
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="輸入 BLE 訊息..."
              className="min-w-0 flex-1 bg-slate-950 border border-white/10 rounded-lg px-4 py-3 text-base sm:text-sm outline-none focus:border-amber-500/50"
            />
            <button
              disabled={!connectedId || isSending}
              className="px-4 py-3 rounded-lg bg-amber-500 text-black text-sm font-black disabled:opacity-40"
            >
              傳送
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "BLE 操作失敗";
}
