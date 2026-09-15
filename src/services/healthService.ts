import { Capacitor } from '@capacitor/core';

// cordova-plugin-health 3.x exposes cordova.plugins.health, whereas the
// Awesome Cordova wrapper still looks for navigator.health.
interface NativeHealth {
  isAvailable(success: (available: boolean) => void, error: (error: unknown) => void): void;
  requestAuthorization(types: { read: string[] }, success: () => void, error: (error: unknown) => void): void;
  query(options: { startDate: Date; endDate: Date; dataType: string; limit: number; ascending: boolean },
    success: (rows: { value: unknown }[]) => void, error: (error: unknown) => void): void;
}

function nativeHealth(): NativeHealth | undefined {
  if (!Capacitor.isNativePlatform()) return undefined;
  return (globalThis as typeof globalThis & {
    cordova?: { plugins?: { health?: NativeHealth } };
  }).cordova?.plugins?.health;
}

let ready = false;
let initialization: Promise<boolean> | null = null;

export function initHealthKit(): Promise<boolean> {
  if (initialization) return initialization;
  initialization = (async () => {
    const health = nativeHealth();
    if (!health) return false;
    try {
      const available = await new Promise<boolean>((resolve, reject) => health.isAvailable(resolve, reject));
      if (!available) return false;
      await new Promise<void>((resolve, reject) => health.requestAuthorization({ read: ['heart_rate'] }, resolve, reject));
      ready = true;
      return true;
    } catch (error) {
      console.warn('HealthKit 初始化或授權失敗:', error);
      return false;
    }
  })();
  return initialization;
}

export async function getLatestHeartRate(): Promise<number | null> {
  const health = nativeHealth();
  if (!ready || !health) return null;
  try {
    const results = await new Promise<{ value: unknown }[]>((resolve, reject) => health.query({
      startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      endDate: new Date(), dataType: 'heart_rate', limit: 1, ascending: false,
    }, resolve, reject));
    const value = Number(results?.[0]?.value);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  } catch (error) {
    // Stop repeated failing native calls for this session.
    ready = false;
    console.warn('心率讀取失敗，本次啟動停止自動查詢:', error);
    return null;
  }
}
