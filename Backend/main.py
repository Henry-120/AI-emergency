from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from . import schemas
from .services.cwa_service import CWAService
from .services.firebase_service import firebase_service
from .services.offline_maps_service import offline_maps_service
from .services.room_risk_service import room_risk_service
from .services.shelter_service import shelter_service
import os
from pathlib import Path

# Load environment variables from .env files when starting the backend directly.
# This ensures CWA_API_KEY from .env.local is available without requiring external env loader.
for env_file in [Path(__file__).resolve().parent.parent / ".env.local", Path(__file__).resolve().parent.parent / ".env"]:
    if env_file.exists():
        with env_file.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "capacitor://localhost",
        "ionic://localhost",
    ],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

cwa = CWAService(api_key=os.getenv("CWA_API_KEY"))

@app.get("/api/weather/latest")
async def get_weather():
    return await cwa.get_latest_alert()

@app.post("/api/sync/status")
async def sync_status(status: schemas.UserStatusCreate):
    doc_id = firebase_service.save_user_status(status)
    return {"status": "saved", "id": doc_id}


@app.post("/api/sync/bulk_status")
def sync_bulk_status(data: schemas.UserStatusBulk):
    firebase_service.save_user_status_bulk(data.records)
    return {"message": f"Successfully synced {len(data.records)} records"}


# ==================== 室內地震家具風險分析 API 端點 ====================

@app.post("/api/room-risk/analyze", response_model=schemas.RoomRiskAnalysisResponse)
async def analyze_room_risk(
    image: UploadFile = File(...),
    sensor_context: str = Form(""),
):
    """分析室內照片中的家具倒塌、玻璃、逃生動線與相對安全區。"""
    content_type = image.content_type or ""
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="請上傳圖片檔。")

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="圖片內容為空。")
    if len(image_bytes) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="圖片太大，請使用 8MB 以下的照片。")

    try:
        return await room_risk_service.analyze_image(
            image_bytes=image_bytes,
            content_type=content_type,
            sensor_context=sensor_context,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"房間風險分析失敗：{exc}") from exc


# ==================== 離線避難導航 API 端點 ====================

@app.get("/api/shelters/nearby")
async def get_nearby_shelters(
    latitude: float,
    longitude: float,
    radius_km: float = 10,
):
    """下載並回傳使用者附近的避難收容處所，供前端離線快取。"""
    result = shelter_service.get_nearby_shelters(latitude, longitude, radius_km)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error", "避難所查詢失敗"))
    return result


@app.post("/api/shelters/refresh")
async def refresh_shelter_cache():
    """重新整理全台避難所快取。"""
    return shelter_service.refresh_cache()


# ==================== 離線地圖 API 端點 ====================

@app.post("/api/offline-maps/download")
async def download_offline_map(request: schemas.MapDownloadRequest):
    """
    下載指定位置的離線地圖
    """
    result = offline_maps_service.download_map_tiles(
        latitude=request.latitude,
        longitude=request.longitude,
        radius_km=request.radius_km,
        zoom_levels=request.zoom_levels,
        map_id=request.map_id,
    )
    
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    
    return result


@app.get("/api/offline-maps/list")
async def list_offline_maps():
    """取得所有已下載的地圖列表"""
    return offline_maps_service.get_downloaded_maps()


@app.get("/api/offline-maps/{map_id}")
async def get_offline_map_info(map_id: str):
    """取得特定地圖的詳細信息"""
    map_info = offline_maps_service.get_map_info(map_id)
    
    if not map_info:
        raise HTTPException(status_code=404, detail=f"地圖 {map_id} 不存在")
    
    return map_info


@app.get("/api/offline-maps/{map_id}/tiles/{z}/{x}/{y}.png")
async def get_offline_map_tile(map_id: str, z: int, x: int, y: int):
    """從本地離線地圖磁碟服務單一瓦片。"""
    tile_path = offline_maps_service.get_tile_path(map_id, z, x, y)
    if not tile_path:
        raise HTTPException(status_code=404, detail="瓦片不存在")
    return FileResponse(tile_path, media_type="image/png")


@app.get("/api/offline-maps/{map_id}/preview", response_class=HTMLResponse)
async def get_offline_map_preview(map_id: str):
    """提供離線地圖預覽頁面，並支援離線定位與簡單導航提示。"""
    map_info = offline_maps_service.get_map_info(map_id)
    if not map_info:
        raise HTTPException(status_code=404, detail=f"地圖 {map_id} 不存在")

    center_lat = map_info["center_latitude"]
    center_lon = map_info["center_longitude"]
    zoom_levels = map_info.get("zoom_levels", [])
    zoom = zoom_levels[len(zoom_levels) // 2] if zoom_levels else 14
    tile_x, tile_y = offline_maps_service.latlon_to_tile(center_lat, center_lon, zoom)

    html_content = f"""
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>離線地圖預覽 - {map_id}</title>
  <style>
    body {{ background: #06101f; color: #eef2ff; font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; padding: 0; }}
    .container {{ padding: 18px; }}
    .title {{ font-size: 20px; margin-bottom: 10px; }}
    .info {{ font-size: 14px; margin-bottom: 16px; color: #a8b8d6; }}
    .map-grid {{ display: grid; grid-template-columns: repeat(5, 1fr); gap: 1px; background: #1f2937; max-width: 500px; margin-bottom: 16px; }}
    .map-grid img {{ width: 100%; height: auto; display: block; background: #111827; }}
    .overlay {{ position: fixed; right: 18px; top: 18px; background: rgba(15, 23, 42, 0.92); border: 1px solid #334155; border-radius: 14px; padding: 14px; width: min(320px, calc(100vw - 40px)); }}
    .badge {{ display: inline-block; margin-right: 6px; margin-bottom: 6px; padding: 4px 10px; border-radius: 999px; background: #0f172a; color: #cbd5e1; font-size: 12px; }}
    .marker {{ position: absolute; left: calc(50% - 9px); top: calc(50% - 9px); width: 18px; height: 18px; border-radius: 50%; background: #facc15; border: 2px solid #fff; box-shadow: 0 0 18px rgba(250, 204, 21, 0.45); }}
  </style>
</head>
<body>
  <div class="container">
    <div class="title">離線地圖預覽 - {map_id}</div>
    <div class="info">中心座標：{center_lat:.5f}, {center_lon:.5f} &nbsp; | &nbsp; 總瓦片數：{map_info.get('tiles_count', 0)} &nbsp; | &nbsp; 預覽縮放：{zoom}</div>
    <div class="map-grid" id="mapGrid">
"""

    for dy in range(-2, 3):
        for dx in range(-2, 3):
            html_content += f"      <img src=\"/api/offline-maps/{map_id}/tiles/{zoom}/{tile_x + dx}/{tile_y + dy}.png\" alt=\"tile\" onerror=\"this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=256 height=256><rect width=256 height=256 fill=\\'rgb(15,23,42)\\'/><text x=128 y=130 font-size=18 text-anchor=middle fill=\\'rgb(148,163,184)\\'>缺少瓦片</text></svg>'\" />\n"

    html_content += f"""
    </div>
    <div class="overlay">
      <div class="badge">離線預覽</div>
      <div class="badge">中心 tile: {tile_x}, {tile_y}</div>
      <div id="statusText">正在嘗試取得目前定位…</div>
      <div id="navText" style="margin-top: 10px; color: #e2e8f0;"></div>
    </div>
    <div style="margin-top: 16px; font-size: 12px; color: #94a3b8;">若此頁無法取得定位，請允許瀏覽器定位權限；離線地圖顯示取決於是否已正確下載瓦片。可返回 App 重新下載更多縮放層級。</div>
  </div>

  <script>
    const centerLat = {center_lat};
    const centerLon = {center_lon};

    function toRad(deg) {{ return deg * Math.PI / 180; }}
    function distanceKm(lat1, lon1, lat2, lon2) {{
      const R = 6371;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return R * c;
    }}
    function bearing(lat1, lon1, lat2, lon2) {{
      const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
      const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
        Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
      const brng = Math.atan2(y, x);
      return (brng * 180 / Math.PI + 360) % 360;
    }}
    function headingText(b) {{
      if (b >= 337.5 || b < 22.5) return '北';
      if (b < 67.5) return '北東';
      if (b < 112.5) return '東';
      if (b < 157.5) return '東南';
      if (b < 202.5) return '南';
      if (b < 247.5) return '西南';
      if (b < 292.5) return '西';
      return '西北';
    }}

    const statusText = document.getElementById('statusText');
    const navText = document.getElementById('navText');

    function updateStatus(lat, lon) {{
      const dist = distanceKm(lat, lon, centerLat, centerLon).toFixed(2);
      const head = bearing(lat, lon, centerLat, centerLon);
      statusText.textContent = `目前位置：${{lat.toFixed(5)}}, ${{lon.toFixed(5)}}；距離中心約 ${{dist}} 公里。`;
      navText.textContent = `導航方向：向 ${{headingText(head)}} 前進（${{head.toFixed(0)}}°）。`;
    }}

    if (navigator.geolocation) {{
      navigator.geolocation.getCurrentPosition(
        (pos) => updateStatus(pos.coords.latitude, pos.coords.longitude),
        (err) => {{
          statusText.textContent = `無法取得定位：${{err.message}}`;
          navText.textContent = '請確認定位權限與安全連線。';
        }},
        {{ enableHighAccuracy: true, timeout: 10000 }}
      );
    }} else {{
      statusText.textContent = '此裝置不支援地理定位。';
      navText.textContent = '無法進行離線定位導航。';
    }}
  </script>
</body>
</html>
"""

    return HTMLResponse(content=html_content)


@app.delete("/api/offline-maps/{map_id}")
async def delete_offline_map(map_id: str):
    """刪除已下載的地圖"""
    result = offline_maps_service.delete_map(map_id)
    
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    
    return result


@app.post("/api/offline-maps/cleanup")
async def cleanup_old_maps(days: int = 7):
    """清理超過指定天數的舊地圖"""
    result = offline_maps_service.cleanup_old_maps(days=days)
    
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    
    return result
