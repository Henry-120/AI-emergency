import os
import json
import shutil
import hashlib
from pathlib import Path
from typing import Optional, Tuple, Dict, Any
from datetime import datetime
import requests
import logging
import math

logger = logging.getLogger(__name__)

class OfflineMapsService:
    """
    離線地圖服務 - 根據使用者位置下載和管理離線地圖
    """
    
    def __init__(self):
        # OSM 官方 tile.openstreetmap.org 不允許離線批量下載。
        # 正式離線功能請改用可授權快取的 tile provider 或自架 tile server。
        self.map_tiles_url = os.getenv(
            "MAP_TILES_URL",
            "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        )
        self.user_agent = os.getenv(
            "MAP_TILES_USER_AGENT",
            "GuardiaAI/0.1 offline-map-prototype (contact: set-MAP_TILES_USER_AGENT)",
        )
        self.referer = os.getenv("MAP_TILES_REFERER", "http://localhost:3000/")
        self.blocked_tile_hashes = {
            # OpenStreetMap blocked-tile placeholder currently seen in local cache.
            "0cfb5f443183efc5921f61005aaa7f341fcfd143",
        }

        # 離線地圖存儲目錄
        self.offline_maps_dir = Path("./data/offline_maps")
        self.offline_maps_dir.mkdir(parents=True, exist_ok=True)
        
        # 元資料檔案
        self.metadata_file = self.offline_maps_dir / "metadata.json"
        self._load_metadata()
    
    def _load_metadata(self) -> None:
        """載入離線地圖的元資料"""
        if self.metadata_file.exists():
            with open(self.metadata_file, 'r', encoding='utf-8') as f:
                self.metadata = json.load(f)
        else:
            self.metadata = {"maps": {}}
    
    def _save_metadata(self) -> None:
        """保存離線地圖的元資料"""
        with open(self.metadata_file, 'w', encoding='utf-8') as f:
            json.dump(self.metadata, f, ensure_ascii=False, indent=2)
    
    def calculate_tile_bounds(
        self, 
        latitude: float, 
        longitude: float, 
        radius_km: float
    ) -> Tuple[float, float, float, float]:
        """
        根據中心點和半徑計算瓦片邊界
        
        Args:
            latitude: 中心點緯度
            longitude: 中心點經度
            radius_km: 搜索半徑（公里）
        
        Returns:
            (min_lat, min_lon, max_lat, max_lon)
        """
        # 1度大約 111 公里
        delta_lat = radius_km / 111.0
        # 經度因緯度而異
        delta_lon = radius_km / (111.0 * abs(__import__('math').cos(__import__('math').radians(latitude))))
        
        min_lat = latitude - delta_lat
        max_lat = latitude + delta_lat
        min_lon = longitude - delta_lon
        max_lon = longitude + delta_lon
        
        return (min_lat, min_lon, max_lat, max_lon)
    
    def download_map_tiles(
        self,
        latitude: float,
        longitude: float,
        radius_km: float = 5.0,
        zoom_levels: list = None,
        map_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        下載指定位置的離線地圖瓦片
        
        Args:
            latitude: 中心點緯度
            longitude: 中心點經度
            radius_km: 搜索半徑（公里）
            zoom_levels: 要下載的縮放級別列表，預設 [12, 13, 14, 15, 16]
            map_id: 地圖 ID，用於識別和管理
        
        Returns:
            包含下載狀態和信息的字典
        """
        try:
            if zoom_levels is None:
                zoom_levels = [12, 13, 14, 15, 16]
            
            if map_id is None:
                map_id = f"map_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            
            # 建立地圖目錄
            map_dir = self.offline_maps_dir / map_id
            map_dir.mkdir(parents=True, exist_ok=True)
            
            # 計算邊界
            min_lat, min_lon, max_lat, max_lon = self.calculate_tile_bounds(
                latitude, longitude, radius_km
            )
            
            logger.info(f"開始下載離線地圖: {map_id}")
            logger.info(f"位置: ({latitude}, {longitude}), 半徑: {radius_km}km")
            logger.info(f"邊界: lat({min_lat:.4f}-{max_lat:.4f}), lon({min_lon:.4f}-{max_lon:.4f})")
            
            # 存儲元資料
            map_metadata = {
                "map_id": map_id,
                "center_latitude": latitude,
                "center_longitude": longitude,
                "radius_km": radius_km,
                "zoom_levels": zoom_levels,
                "bounds": {
                    "min_lat": min_lat,
                    "max_lat": max_lat,
                    "min_lon": min_lon,
                    "max_lon": max_lon
                },
                "downloaded_at": datetime.now().isoformat(),
                "status": "completed",
                "tiles_count": 0
            }
            
            tiles_count = self._download_tiles(
                map_dir, zoom_levels, min_lat, max_lat, min_lon, max_lon
            )

            if tiles_count == 0:
                shutil.rmtree(map_dir, ignore_errors=True)
                return {
                    "success": False,
                    "error": (
                        "沒有下載到有效瓦片。若來源是 tile.openstreetmap.org，"
                        "代表此離線批量下載用法可能已被 OSM 封鎖；請改用允許離線快取的 tile provider。"
                    ),
                    "message": "下載離線地圖失敗"
                }
            
            map_metadata["tiles_count"] = tiles_count
            
            # 保存元資料
            self.metadata["maps"][map_id] = map_metadata
            self._save_metadata()
            
            return {
                "success": True,
                "map_id": map_id,
                "message": f"成功下載離線地圖 {map_id}",
                "tiles_count": tiles_count,
                "map_path": str(map_dir)
            }
        
        except Exception as e:
            logger.error(f"下載離線地圖失敗: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "message": "下載離線地圖失敗"
            }

    def _is_osm_default_tile_server(self) -> bool:
        return "tile.openstreetmap.org" in self.map_tiles_url
    
    def latlon_to_tile(self, latitude: float, longitude: float, zoom: int) -> Tuple[int, int]:
        """將經緯度轉換為 XYZ 瓦片座標"""
        lat_rad = math.radians(latitude)
        n = 2 ** zoom
        x_tile = int((longitude + 180.0) / 360.0 * n)
        y_tile = int(
            (1.0 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi)
            / 2.0
            * n
        )
        return x_tile, y_tile

    def _download_tiles(
        self,
        map_dir: Path,
        zoom_levels: list,
        min_lat: float,
        max_lat: float,
        min_lon: float,
        max_lon: float,
    ) -> int:
        """實際下載指定範圍內的瓦片"""
        tiles_count = 0

        for zoom in zoom_levels:
            zoom_dir = map_dir / f"z{zoom}"
            zoom_dir.mkdir(parents=True, exist_ok=True)

            min_x, min_y = self.latlon_to_tile(max_lat, min_lon, zoom)
            max_x, max_y = self.latlon_to_tile(min_lat, max_lon, zoom)

            # 確保從小到大，避免負值或反向
            min_x, max_x = min(min_x, max_x), max(min_x, max_x)
            min_y, max_y = min(min_y, max_y), max(min_y, max_y)

            max_x = min(max_x, min_x + 9)
            max_y = min(max_y, min_y + 9)

            for x in range(min_x, max_x + 1):
                for y in range(min_y, max_y + 1):
                    tile_file = zoom_dir / f"{x}_{y}.png"
                    if self._is_valid_tile_file(tile_file):
                        tiles_count += 1
                        continue

                    tile_url = self.map_tiles_url.format(z=zoom, x=x, y=y)
                    try:
                        response = requests.get(
                            tile_url,
                            timeout=15,
                            headers={
                                "User-Agent": self.user_agent,
                                "Referer": self.referer,
                            },
                        )
                        if self._is_valid_tile_response(response):
                            tile_file.write_bytes(response.content)
                            tiles_count += 1
                        elif response.status_code in {403, 429}:
                            if tile_file.exists():
                                tile_file.unlink()
                            logger.warning(
                                f"瓦片服務拒絕請求 {zoom}/{x}/{y}: HTTP {response.status_code}. "
                                "請改用允許離線快取的 tile provider 或自架 tile server。"
                            )
                        else:
                            if tile_file.exists() and tile_file.stat().st_size == 0:
                                tile_file.unlink()
                            logger.warning(
                                f"無法下載瓦片 {zoom}/{x}/{y}: HTTP {response.status_code}"
                            )
                    except Exception as exc:
                        logger.warning(
                            f"下載瓦片失敗 {zoom}/{x}/{y}: {str(exc)}"
                        )

        return tiles_count

    def _tile_sha1(self, content: bytes) -> str:
        return hashlib.sha1(content).hexdigest()

    def _is_blocked_tile_content(self, content: bytes) -> bool:
        return self._tile_sha1(content) in self.blocked_tile_hashes

    def _is_valid_tile_response(self, response: requests.Response) -> bool:
        if response.status_code != 200 or not response.content:
            return False

        content_type = response.headers.get("content-type", "").lower()
        if "image/" not in content_type and not response.content.startswith(b"\x89PNG"):
            return False

        if self._is_blocked_tile_content(response.content):
            return False

        return True

    def _is_valid_tile_file(self, tile_file: Path) -> bool:
        if not tile_file.exists() or tile_file.stat().st_size <= 0:
            return False

        try:
            content = tile_file.read_bytes()
        except OSError:
            return False

        if not content.startswith(b"\x89PNG"):
            return False

        return not self._is_blocked_tile_content(content)

    def get_tile_path(
        self,
        map_id: str,
        zoom: int,
        x: int,
        y: int,
    ) -> Optional[Path]:
        map_dir = self.offline_maps_dir / map_id
        tile_path = map_dir / f"z{zoom}" / f"{x}_{y}.png"
        if self._is_valid_tile_file(tile_path):
            return tile_path
        return None

    def _get_tile_inventory(self, map_id: str) -> Dict[str, Any]:
        """掃描本地有效瓦片，提供前端內建預覽使用。"""
        map_dir = self.offline_maps_dir / map_id
        inventory: Dict[str, Any] = {}

        if not map_dir.exists():
            return inventory

        for zoom_dir in sorted(map_dir.glob("z*")):
            if not zoom_dir.is_dir():
                continue

            try:
                zoom = int(zoom_dir.name[1:])
            except ValueError:
                continue

            tiles = []
            for tile_file in zoom_dir.glob("*.png"):
                if not self._is_valid_tile_file(tile_file):
                    continue

                try:
                    x_str, y_str = tile_file.stem.split("_", 1)
                    tiles.append({"x": int(x_str), "y": int(y_str)})
                except ValueError:
                    continue

            if not tiles:
                inventory[str(zoom)] = {
                    "count": 0,
                    "tiles": [],
                    "min_x": None,
                    "max_x": None,
                    "min_y": None,
                    "max_y": None,
                }
                continue

            xs = [tile["x"] for tile in tiles]
            ys = [tile["y"] for tile in tiles]
            inventory[str(zoom)] = {
                "count": len(tiles),
                "tiles": tiles,
                "min_x": min(xs),
                "max_x": max(xs),
                "min_y": min(ys),
                "max_y": max(ys),
            }

        return inventory

    def _with_tile_inventory(self, map_info: Dict[str, Any]) -> Dict[str, Any]:
        enriched = dict(map_info)
        inventory = self._get_tile_inventory(enriched["map_id"])
        enriched["tile_inventory"] = inventory
        enriched["valid_tiles_count"] = sum(
            zoom_info.get("count", 0) for zoom_info in inventory.values()
        )
        return enriched
    
    def get_downloaded_maps(self) -> Dict[str, Any]:
        """取得所有已下載的地圖列表"""
        maps = {
            map_id: self._with_tile_inventory(map_info)
            for map_id, map_info in self.metadata.get("maps", {}).items()
        }
        return {
            "maps": maps,
            "count": len(maps)
        }
    
    def get_map_info(self, map_id: str) -> Optional[Dict[str, Any]]:
        """取得特定地圖的信息"""
        map_info = self.metadata.get("maps", {}).get(map_id)
        if not map_info:
            return None
        return self._with_tile_inventory(map_info)
    
    def delete_map(self, map_id: str) -> Dict[str, Any]:
        """刪除已下載的地圖"""
        try:
            map_dir = self.offline_maps_dir / map_id
            
            if map_dir.exists():
                shutil.rmtree(map_dir)
                logger.info(f"已刪除地圖: {map_id}")
            
            # 移除元資料
            if map_id in self.metadata.get("maps", {}):
                del self.metadata["maps"][map_id]
                self._save_metadata()
            
            return {
                "success": True,
                "message": f"成功刪除地圖 {map_id}"
            }
        
        except Exception as e:
            logger.error(f"刪除地圖失敗: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "message": "刪除地圖失敗"
            }
    
    def cleanup_old_maps(self, days: int = 7) -> Dict[str, Any]:
        """清理超過指定天數的舊地圖"""
        from datetime import timedelta
        
        try:
            cutoff_time = datetime.now() - timedelta(days=days)
            deleted_maps = []
            
            for map_id, map_info in list(self.metadata.get("maps", {}).items()):
                downloaded_at = datetime.fromisoformat(map_info["downloaded_at"])
                
                if downloaded_at < cutoff_time:
                    result = self.delete_map(map_id)
                    if result["success"]:
                        deleted_maps.append(map_id)
            
            return {
                "success": True,
                "deleted_maps": deleted_maps,
                "count": len(deleted_maps)
            }
        
        except Exception as e:
            logger.error(f"清理舊地圖失敗: {str(e)}")
            return {
                "success": False,
                "error": str(e)
            }


# 全域實例
offline_maps_service = OfflineMapsService()
        
