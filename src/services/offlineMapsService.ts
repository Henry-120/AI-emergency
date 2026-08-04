import { BACKEND } from "./backend";

export interface MapDownloadRequest {
  latitude: number;
  longitude: number;
  radius_km?: number;
  zoom_levels?: number[];
  map_id?: string;
}

export interface MapInfo {
  map_id: string;
  center_latitude: number;
  center_longitude: number;
  radius_km: number;
  zoom_levels: number[];
  bounds: {
    min_lat: number;
    max_lat: number;
    min_lon: number;
    max_lon: number;
  };
  downloaded_at: string;
  status: string;
  tiles_count: number;
  valid_tiles_count?: number;
  tile_inventory?: Record<
    string,
    {
      count: number;
      tiles: Array<{ x: number; y: number }>;
      min_x: number | null;
      max_x: number | null;
      min_y: number | null;
      max_y: number | null;
    }
  >;
}

export interface DownloadMapResponse {
  success: boolean;
  map_id?: string;
  message: string;
  tiles_count?: number;
  map_path?: string;
  error?: string;
}

/**
 * 下載使用者位置周圍的離線地圖
 */
export async function downloadOfflineMap(
  latitude: number,
  longitude: number,
  options?: {
    radius_km?: number;
    zoom_levels?: number[];
    map_id?: string;
  },
): Promise<DownloadMapResponse> {
  try {
    const body = {
      latitude,
      longitude,
      radius_km: options?.radius_km ?? 5,
      zoom_levels: options?.zoom_levels ?? [12, 13, 14, 15, 16],
      map_id: options?.map_id,
    };

    const res = await fetch(`${BACKEND}/api/offline-maps/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.detail || `HTTP ${res.status}`);
    }

    return await res.json();
  } catch (error) {
    console.error("下載離線地圖失敗:", error);
    return {
      success: false,
      message: "下載失敗，請稍後重試",
      error: error instanceof Error ? error.message : "未知錯誤",
    };
  }
}

/**
 * 取得所有已下載的地圖列表
 */
export async function getDownloadedMaps(): Promise<{
  maps: Record<string, MapInfo>;
  count: number;
}> {
  try {
    const res = await fetch(`${BACKEND}/api/offline-maps/list`);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    return await res.json();
  } catch (error) {
    console.error("無法取得地圖列表:", error);
    return { maps: {}, count: 0 };
  }
}

/**
 * 取得特定地圖的詳細信息
 */
export async function getMapInfo(mapId: string): Promise<MapInfo | null> {
  try {
    const res = await fetch(`${BACKEND}/api/offline-maps/${mapId}`);

    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`HTTP ${res.status}`);
    }

    return await res.json();
  } catch (error) {
    console.error(`無法取得地圖 ${mapId} 的信息:`, error);
    return null;
  }
}

export function getOfflineMapPreviewUrl(map: MapInfo): string {
  return `${BACKEND}/api/offline-maps/${map.map_id}/preview`;
}

/**
 * 刪除已下載的地圖
 */
export async function deleteOfflineMap(mapId: string): Promise<{
  success: boolean;
  message: string;
  error?: string;
}> {
  try {
    const res = await fetch(`${BACKEND}/api/offline-maps/${mapId}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.detail || `HTTP ${res.status}`);
    }

    return await res.json();
  } catch (error) {
    console.error("刪除地圖失敗:", error);
    return {
      success: false,
      message: "刪除失敗，請稍後重試",
      error: error instanceof Error ? error.message : "未知錯誤",
    };
  }
}

/**
 * 清理超過指定天數的舊地圖
 */
export async function cleanupOldMaps(days: number = 7): Promise<{
  success: boolean;
  deleted_maps?: string[];
  count?: number;
  error?: string;
}> {
  try {
    const res = await fetch(
      `${BACKEND}/api/offline-maps/cleanup?days=${days}`,
      {
        method: "POST",
      },
    );

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.detail || `HTTP ${res.status}`);
    }

    return await res.json();
  } catch (error) {
    console.error("清理舊地圖失敗:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "未知錯誤",
    };
  }
}

/**
 * 根據使用者當前位置下載離線地圖
 * 使用地理定位 API
 */
export async function downloadMapForCurrentLocation(options?: {
  radius_km?: number;
  zoom_levels?: number[];
}): Promise<DownloadMapResponse> {
  try {
    const position = await new Promise<GeolocationCoordinates>(
      (resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos.coords),
          reject,
        );
      },
    );

    return downloadOfflineMap(position.latitude, position.longitude, options);
  } catch (error) {
    console.error("無法取得位置信息:", error);
    return {
      success: false,
      message: "無法取得位置信息，請檢查定位權限",
      error: error instanceof Error ? error.message : "定位失敗",
    };
  }
}
