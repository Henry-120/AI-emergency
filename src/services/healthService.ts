import { Health } from '@awesome-cordova-plugins/health';
import { Capacitor } from '@capacitor/core';

/**
 * 初始化並請求 iOS HealthKit 讀取心律的權限
 */
export const initHealthKit = async (): Promise<boolean> => {
  // 如果不是在 iOS/Android 原生環境（例如在電腦瀏覽器測試），直接跳過
  if (!Capacitor.isNativePlatform()) {
    return false;
  }

  try {
    const isAvailable = await Health.isAvailable();
    if (isAvailable) {
      // 請求讀取心率 (heart_rate) 權限
      await Health.requestAuthorization([
        { read: ['heart_rate'] }
      ]);
      console.log('HealthKit 授權成功');
      return true;
    }
  } catch (error) {
    console.warn('HealthKit 初始化或授權失敗:', error);
  }
  return false;
};

/**
 * 取得最新的一筆心率數據 (BPM)
 */
export const getLatestHeartRate = async (): Promise<number | null> => {
  // 非原生環境直接回傳 null
  if (!Capacitor.isNativePlatform()) {
    return null;
  }

  try {
    const results = await Health.query({
      startDate: new Date(new Date().getTime() - 24 * 60 * 60 * 1000), // 查詢過去 24 小時內
      endDate: new Date(),
      dataType: 'heart_rate',
      limit: 1, // 只拿最新 1 筆
      ascending: false
    });

    if (results && results.length > 0) {
      // 回傳最新的心率數值
      return Math.round(Number(results[0].value));
    }
  } catch (error) {
    console.error('讀取 HealthKit 心率失敗:', error);
  }
  return null;
};