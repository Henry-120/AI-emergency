import asyncio
import base64
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from . import auth, schemas
from .services.cwa_service import CWAService
from .services.offline_maps_service import offline_maps_service
from .services.room_risk_service import room_risk_service
from .services.disaster_ai_service import DisasterAIError, disaster_ai_service
from .services.shelter_service import shelter_service
from .services.firebase_service import firebase_service
from .services import push_service
from .services import sos_service
from .services.sos_store_service import sos_store_service

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

cwa = CWAService(api_key=os.getenv("CWA_API_KEY"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    tasks = []
    # Request-based Cloud Run may suspend CPU between requests. Keep permanent
    # polling opt-in; production can trigger this work with Cloud Scheduler.
    if os.getenv("ENABLE_PUSH_POLLING", "false").lower() == "true":
        tasks.append(asyncio.create_task(push_service.poll_and_push_loop(cwa)))
    if os.getenv("ENABLE_TEST_PUSH", "false").lower() == "true":
        tasks.append(asyncio.create_task(push_service.test_poll_and_push_loop(cwa)))
    yield
    for task in tasks:
        task.cancel()


app = FastAPI(lifespan=lifespan)

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


# ==================== 認證 / 帳號 API ====================

def get_current_user(
    authorization: Optional[str] = Header(default=None),
) -> dict:
    """從 Authorization: Bearer <token> 標頭解析出目前登入的使用者。"""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="尚未登入")
    token = authorization.split(" ", 1)[1].strip()
    payload = auth.decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="登入憑證無效或已過期")
    user = firebase_service.get_user(str(payload["uid"]))
    if not user:
        raise HTTPException(status_code=401, detail="使用者不存在")
    return user


@app.post("/api/auth/register", response_model=schemas.AuthResponse)
def register(data: schemas.RegisterRequest):
    username = data.username.strip()
    if len(username) < 2:
        raise HTTPException(status_code=400, detail="帳號至少需 2 個字元")
    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="密碼至少需 6 個字元")
    email = (data.email or "").strip() or None
    try:
        user = firebase_service.create_user(
            username=username, email=email, password_hash=auth.hash_password(data.password)
        )
    except ValueError as exc:
        if str(exc) == "username_exists":
            raise HTTPException(status_code=409, detail="此帳號已被註冊") from exc
        if str(exc) == "email_exists":
            raise HTTPException(status_code=409, detail="此 Email 已被註冊") from exc
        raise
    token = auth.create_token(user["id"], user["username"])
    return {"token": token, "user": user}


@app.post("/api/auth/login", response_model=schemas.AuthResponse)
def login(data: schemas.LoginRequest):
    user = firebase_service.get_user_by_username(data.username.strip())
    if not user or not auth.verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="帳號或密碼錯誤")
    token = auth.create_token(user["id"], user["username"])
    return {"token": token, "user": user}


@app.get("/api/auth/me", response_model=schemas.UserResponse)
def get_me(current_user: dict = Depends(get_current_user)):
    return current_user


# ==================== 緊急醫療卡 API ====================

@app.get("/api/medical-card", response_model=schemas.MedicalCardResponse)
def get_medical_card(
    current_user: dict = Depends(get_current_user),
):
    return firebase_service.get_medical_card(current_user)


@app.put("/api/medical-card", response_model=schemas.MedicalCardResponse)
def update_medical_card(
    data: schemas.MedicalCardBase,
    current_user: dict = Depends(get_current_user),
):
    return firebase_service.update_medical_card(current_user["id"], data)


# ==================== AI 傷勢 / 救援需求 API ====================

@app.post("/api/ai/analyze", response_model=schemas.AIAnalysisResponse)
async def analyze_disaster(
    data: schemas.AIChatRequest,
    current_user: dict = Depends(get_current_user),
):
    """Use the server-side Gemini key; never expose it to the iOS/web client."""
    try:
        return await disaster_ai_service.analyze(
            messages=[message.model_dump() for message in data.messages],
            sensor_context=data.sensor_context,
            image_base64=data.image_base64,
        )
    except DisasterAIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

@app.put("/api/emergency-report", response_model=schemas.EmergencyReportResponse)
def upsert_emergency_report(
    data: schemas.EmergencyReportUpsert,
    current_user: dict = Depends(get_current_user),
):
    """保存 AI 從完整對話彙整的「當前」傷勢與救援需求。"""
    return firebase_service.upsert_emergency_report(current_user["id"], data)


@app.get("/api/emergency-report", response_model=schemas.EmergencyReportResponse)
def get_emergency_report(
    current_user: dict = Depends(get_current_user),
):
    report = firebase_service.get_emergency_report(current_user["id"])
    if not report:
        raise HTTPException(status_code=404, detail="尚無救援摘要")
    return report


@app.get("/api/rescue/nearby", response_model=list[schemas.RescueCaseResponse])
def get_nearby_rescue_cases(
    latitude: float,
    longitude: float,
    radius_km: float = 50,
    current_user: dict = Depends(get_current_user),
):
    """回傳救難隊位置周圍、由 AI 判定需要救援且有 GPS 的案件。"""
    radius_km = max(1, min(radius_km, 200))
    return firebase_service.get_nearby_rescue_cases(latitude, longitude, radius_km)


@app.get("/api/weather/latest")
async def get_weather():
    return await cwa.get_latest_alert()


@app.get("/api/weather/list")
async def get_weather_list():
    return await cwa.get_earthquake_list()


# ==================== 推播裝置註冊 API ====================

@app.post("/api/push/register", response_model=schemas.DeviceTokenResponse)
def register_device_token(
    data: schemas.DeviceTokenRegister,
    authorization: Optional[str] = Header(default=None),
):
    """註冊裝置的 FCM token 以接收強震推播。未登入也可註冊。"""
    user_id = None
    if authorization and authorization.lower().startswith("bearer "):
        payload = auth.decode_token(authorization.split(" ", 1)[1].strip())
        if payload:
            user_id = str(payload["uid"])
    firebase_service.register_device_token(data.token, data.platform, user_id)
    return {"status": "registered"}


@app.post("/api/push/unregister", response_model=schemas.DeviceTokenResponse)
def unregister_device_token(data: schemas.DeviceTokenRegister):
    firebase_service.unregister_device_token(data.token)
    return {"status": "unregistered"}


@app.post("/api/sync/status")
async def sync_status(status: schemas.UserStatusCreate):
    document_id = firebase_service.save_user_status(status)
    return {"status": "saved", "id": document_id}


@app.post("/api/sync/bulk_status")
def sync_bulk_status(data: schemas.UserStatusBulk):
    firebase_service.save_user_status_bulk(data.records)
    return {"message": f"Successfully synced {len(data.records)} records"}


# ==================== SOS 多跳中繼 API 端點 ====================
#
# 呼叫者是「剛好有網路的中繼者」，不一定是求救本人，也不需要登入——
# 故意不掛 get_current_user：受困者當下可能連帳號都登不進去，中繼者
# 也不該需要先登入才能幫忙轉發一包連自己都解不開的密文。

@app.post("/api/sos/report", response_model=schemas.SosReportResponse)
def report_sos(data: schemas.SosReportRequest):
    """
    接收一包由藍牙多跳中繼送達、途經任意陌生人手機的 SOS/ALERT 封包。

    流程：base64 解碼 → 解析明文標頭 → 用後端私鑰解密內容 → 記錄 →
    簽一份 ACK 回傳，呼叫端應把 ack_packet 當成普通中繼封包繼續往外傳播，
    讓它有機會沿著藍牙網路傳回原本發送求救的裝置。
    """
    try:
        raw = base64.b64decode(data.packet, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"封包 base64 解碼失敗：{exc}") from exc

    try:
        decoded = sos_service.decode_header(raw)
    except sos_service.SosProtocolError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if decoded.header.type == sos_service.PACKET_TYPE_ACK:
        raise HTTPException(status_code=400, detail="ACK 封包不應上傳到此端點")

    try:
        payload = sos_service.decrypt_sos_payload(decoded.body)
    except sos_service.SosProtocolError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    header = decoded.header
    is_new = sos_store_service.save_sos_report(
        msg_id=header.msg_id,
        hops=header.hops,
        urgency_level=header.urgency_level,
        is_trapped=header.is_trapped,
        battery=header.battery,
        location=header.location,
        location_details=header.location_details,
        from_local_id=header.from_local_id,
        payload=payload,
    )

    ack_packet = sos_service.build_ack_packet(decoded.header.msg_id)
    return schemas.SosReportResponse(
        success=True,
        ack_packet=base64.b64encode(ack_packet).decode("ascii"),
        duplicate=not is_new,
    )


@app.get("/api/sos/nearby", response_model=list[schemas.SosCaseResponse])
def get_nearby_sos_reports(
    latitude: float,
    longitude: float,
    radius_km: float = 50,
    current_user: dict = Depends(get_current_user),
):
    """
    救援地圖用：附近透過藍牙中繼送達的求救記錄。

    求救記錄存於現有 Firestore，確保 Cloud Run 重啟後仍能保留。登入要求
    比照現有的救援地圖端點，這個 App 目前沒有另外區分「救援人員」帳號，
    任何登入的使用者都能查看，維持與既有端點一致的權限模型。
    """
    radius_km = max(1, min(radius_km, 200))
    return sos_store_service.get_nearby_sos_reports(latitude, longitude, radius_km)


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
