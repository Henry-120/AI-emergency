import { Capacitor } from "@capacitor/core";
import {
  BleClient,
  BleDevice,
  ScanResult,
} from "@capacitor-community/bluetooth-le";
import type { BLEMessage, NearbyUser } from "../types/ble";

export const GUARDIAN_BLE_SERVICE = "7b5d0001-6f1d-4f37-8c4b-0d8f5c8a1001";
export const GUARDIAN_BLE_MESSAGE_CHARACTERISTIC =
  "7b5d0002-6f1d-4f37-8c4b-0d8f5c8a1001";

type DeviceListener = (users: NearbyUser[]) => void;
type MessageListener = (message: BLEMessage) => void;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let initialized = false;
let scanning = false;
let connectedDevice: BleDevice | null = null;
let devices = new Map<string, NearbyUser>();
let deviceListener: DeviceListener | null = null;
let messageListener: MessageListener | null = null;

export function onNearbyUsersChanged(listener: DeviceListener | null) {
  deviceListener = listener;
}

export function onBleMessage(listener: MessageListener | null) {
  messageListener = listener;
}

export async function initializeBleMessenger() {
  if (initialized) return;

  await BleClient.initialize();
  const enabled = await BleClient.isEnabled();
  if (!enabled && Capacitor.getPlatform() === "android") {
    await BleClient.requestEnable();
  }

  initialized = true;
}

export async function startGuardianScan() {
  await initializeBleMessenger();
  await stopGuardianScan();

  scanning = true;
  devices = new Map();
  emitDevices();

  await BleClient.requestLEScan(
    {
      services: [GUARDIAN_BLE_SERVICE],
      optionalServices: [GUARDIAN_BLE_SERVICE],
      allowDuplicates: true,
    },
    handleScanResult,
  );
}

export async function stopGuardianScan() {
  if (!scanning) return;
  await BleClient.stopLEScan();
  scanning = false;
}

export async function connectGuardianDevice(deviceId: string) {
  await initializeBleMessenger();

  await BleClient.connect(deviceId, () => {
    if (connectedDevice?.deviceId === deviceId) {
      connectedDevice = null;
      updateConnectionState(deviceId, "disconnected");
    }
  });

  const found = devices.get(deviceId);
  connectedDevice = {
    deviceId,
    name: found?.nickname,
  };

  updateConnectionState(deviceId, "connected");
  await BleClient.startNotifications(
    deviceId,
    GUARDIAN_BLE_SERVICE,
    GUARDIAN_BLE_MESSAGE_CHARACTERISTIC,
    handleNotification,
  );
}

export async function disconnectGuardianDevice() {
  if (!connectedDevice) return;

  const deviceId = connectedDevice.deviceId;
  try {
    await BleClient.stopNotifications(
      deviceId,
      GUARDIAN_BLE_SERVICE,
      GUARDIAN_BLE_MESSAGE_CHARACTERISTIC,
    );
  } catch {
    // The device may already be gone.
  }

  await BleClient.disconnect(deviceId);
  connectedDevice = null;
  updateConnectionState(deviceId, "disconnected");
}

export async function sendGuardianMessage(content: string) {
  if (!connectedDevice) {
    throw new Error("尚未連線到 BLE 裝置");
  }

  const payload = JSON.stringify({
    id: createMessageId(),
    content,
    timestamp: new Date().toISOString(),
  });

  await BleClient.write(
    connectedDevice.deviceId,
    GUARDIAN_BLE_SERVICE,
    GUARDIAN_BLE_MESSAGE_CHARACTERISTIC,
    encodeText(payload),
  );

  const message: BLEMessage = {
    id: createMessageId(),
    senderId: "me",
    content,
    timestamp: new Date(),
    isMine: true,
  };
  messageListener?.(message);
  return message;
}

// 自動求生訊號：刻意只帶「訊號類型」與「存活」旗標，不含姓名、位置、醫療資料等個資，
// 讓附近裝置只需要知道「這裡有人活著、需要救援」。
const SOS_SIGNATURE = "GUARDIA_SOS";

export interface SosBroadcastResult {
  attempted: number;
  sent: number;
  failed: number;
}

export async function broadcastSosBeacon(): Promise<SosBroadcastResult> {
  await initializeBleMessenger();

  const targets = Array.from(devices.values());
  const payload = encodeText(
    JSON.stringify({ sig: SOS_SIGNATURE, alive: true, ts: new Date().toISOString() }),
  );

  let sent = 0;
  let failed = 0;

  for (const target of targets) {
    const alreadyConnected = connectedDevice?.deviceId === target.id;
    try {
      if (!alreadyConnected) {
        await BleClient.connect(target.id, () => {});
      }
      await BleClient.write(
        target.id,
        GUARDIAN_BLE_SERVICE,
        GUARDIAN_BLE_MESSAGE_CHARACTERISTIC,
        payload,
      );
      sent += 1;
    } catch {
      failed += 1;
    } finally {
      if (!alreadyConnected) {
        await BleClient.disconnect(target.id).catch(() => {});
      }
    }
  }

  return { attempted: targets.length, sent, failed };
}

export async function startGuardianAdvertising() {
  throw new Error(
    "目前 @capacitor-community/bluetooth-le 不支援手機端 BLE 廣播。iOS 需要額外實作 CoreBluetooth Peripheral/GATT Server plugin。",
  );
}

export function getConnectedGuardianDevice() {
  return connectedDevice;
}

function handleScanResult(result: ScanResult) {
  const deviceId = result.device.deviceId;
  const nickname =
    result.localName || result.device.name || `Guardian ${deviceId.slice(-4)}`;

  devices.set(deviceId, {
    id: deviceId,
    nickname,
    rssi: result.rssi ?? -100,
    distance: estimateDistance(result.rssi),
    lastSeen: new Date(),
    connectionState:
      connectedDevice?.deviceId === deviceId ? "connected" : "disconnected",
  });

  emitDevices();
}

function handleNotification(value: DataView) {
  const raw = decodeText(value);
  let content = raw;
  let id = createMessageId();
  let timestamp = new Date();
  let isSos = false;

  try {
    const parsed = JSON.parse(raw);
    if (parsed.sig === SOS_SIGNATURE && parsed.alive) {
      isSos = true;
      content = "🆘 附近有人存活，需要救援（自動求生訊號，未附個人資料）";
      timestamp = parsed.ts ? new Date(parsed.ts) : timestamp;
    } else {
      content = String(parsed.content || raw);
      id = String(parsed.id || id);
      timestamp = parsed.timestamp ? new Date(parsed.timestamp) : timestamp;
    }
  } catch {
    // Plain-text payloads from compatible devices are still valid messages.
  }

  messageListener?.({
    id,
    senderId: connectedDevice?.deviceId || "unknown",
    content,
    timestamp,
    isMine: false,
    isSos,
  });
}

function updateConnectionState(
  deviceId: string,
  connectionState: NearbyUser["connectionState"],
) {
  const existing = devices.get(deviceId);
  if (!existing) return;
  devices.set(deviceId, { ...existing, connectionState });
  emitDevices();
}

function emitDevices() {
  deviceListener?.(
    Array.from(devices.values()).sort((a, b) => b.rssi - a.rssi),
  );
}

function encodeText(value: string) {
  const bytes = encoder.encode(value);
  return new DataView(bytes.buffer);
}

function decodeText(value: DataView) {
  return decoder.decode(value);
}

function estimateDistance(rssi?: number) {
  if (rssi === undefined) return "未知";
  if (rssi > -55) return "< 2m";
  if (rssi > -70) return "2-5m";
  if (rssi > -85) return "5-10m";
  return "> 10m";
}

function createMessageId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ble-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
