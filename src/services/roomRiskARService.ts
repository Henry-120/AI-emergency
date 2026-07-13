import { Capacitor, registerPlugin } from "@capacitor/core";
import { RoomRiskAnalysis } from "../types";
import { BACKEND } from "./backend";

interface RoomRiskARPlugin {
  isSupported(): Promise<{
    supported: boolean;
    depthSupported: boolean;
  }>;
  start(options: {
    backendUrl: string;
  }): Promise<{
    cancelled?: boolean;
    analysis?: RoomRiskAnalysis;
  }>;
}

const RoomRiskAR = registerPlugin<RoomRiskARPlugin>("RoomRiskAR");
const NATIVE_BACKEND =
  import.meta.env.VITE_NATIVE_BACKEND_URL?.replace(/\/$/, "") || BACKEND;

export const canUseNativeRoomRiskAR = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";

export async function startNativeRoomRiskAR() {
  const capabilities = await RoomRiskAR.isSupported();
  if (!capabilities.supported) {
    throw new Error("此 iPhone 或 iPad 不支援 ARKit 世界追蹤。");
  }

  const backendHost = new URL(NATIVE_BACKEND).hostname;
  if (["localhost", "127.0.0.1", "::1"].includes(backendHost)) {
    throw new Error(
      "請設定 VITE_NATIVE_BACKEND_URL 為 Mac 的區網網址，iPhone 無法使用 localhost 連到 Mac。",
    );
  }

  return RoomRiskAR.start({ backendUrl: NATIVE_BACKEND });
}
