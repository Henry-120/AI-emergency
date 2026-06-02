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
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <header className="safe-area-top flex items-center gap-3 border-b border-line bg-surface px-5 py-4 shadow-[var(--elev-1)]">
        <button
          onClick={onBack}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink transition-colors hover:bg-line"
          aria-label="返回"
        >
          <i className="fas fa-arrow-left text-sm" aria-hidden="true"></i>
        </button>
        <div>
          <p className="text-[11px] font-semibold text-accent">藍牙近距通訊</p>
          <h1 className="text-xl font-bold text-ink">附近互助通訊</h1>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[360px_1fr]">
        <aside className="space-y-4 border-line p-4 lg:border-r">
          <div className="rounded-xl border border-line bg-surface p-4">
            <p className="mb-3 text-xs text-muted">{status}</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleInitialize}
                className="rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-xs font-bold text-ink transition-colors hover:bg-line"
              >
                初始化
              </button>
              <button
                onClick={isScanning ? handleStopScan : handleScan}
                className="rounded-lg bg-primary px-3 py-2.5 text-xs font-bold text-primary-ink transition-transform active:scale-95"
              >
                {isScanning ? "停止掃描" : "掃描"}
              </button>
              <button
                onClick={handleAdvertise}
                className="rounded-lg bg-safe-soft px-3 py-2.5 text-xs font-bold text-safe-text transition-colors"
              >
                廣播
              </button>
              <button
                onClick={handleDisconnect}
                disabled={!connectedId}
                className="rounded-lg border border-line bg-surface px-3 py-2.5 text-xs font-bold text-critical-text transition-colors hover:bg-critical-soft disabled:opacity-40"
              >
                中斷
              </button>
            </div>
          </div>

          <section>
            <h2 className="mb-2 text-xs font-bold text-muted">附近裝置</h2>
            <div className="space-y-2">
              {nearbyUsers.length === 0 ? (
                <div className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">
                  尚未找到 Guardian BLE 裝置
                </div>
              ) : (
                nearbyUsers.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => handleConnect(user)}
                    className="w-full rounded-xl border border-line bg-surface p-3 text-left transition-colors hover:bg-surface-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-bold text-ink">{user.nickname}</p>
                      <span className="font-data text-[10px] text-accent">
                        {user.distance}
                      </span>
                    </div>
                    <p className="mt-1 font-data text-[11px] text-muted">
                      RSSI {user.rssi} · {user.connectionState}
                    </p>
                  </button>
                ))
              )}
            </div>
          </section>
        </aside>

        <section className="flex min-h-0 flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto p-5">
            {messages.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted">
                連線到相容的 Guardian BLE 裝置後即可傳送訊息
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-[78%] rounded-xl px-4 py-3 ${
                    message.isMine
                      ? "ml-auto bg-primary text-primary-ink"
                      : "border border-line bg-surface text-ink"
                  }`}
                >
                  <p className="text-sm font-semibold">{message.content}</p>
                  <p
                    className={`mt-1 font-data text-[10px] ${
                      message.isMine ? "text-white/70" : "text-muted"
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
            className="flex items-center gap-3 border-t border-line bg-surface p-4"
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="輸入 BLE 訊息…"
              className="flex-1 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-primary"
            />
            <button
              disabled={!connectedId || isSending}
              className="rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-ink transition-transform active:scale-95 disabled:opacity-40"
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
