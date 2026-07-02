from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime

# --- 用戶狀態同步用 (對應 React 的 UserStatus) ---
class UserStatusBase(BaseModel):
    user_id: Optional[str] = None
    heart_rate: int
    battery_level: float
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    client_timestamp: Optional[datetime] = None

class UserStatusCreate(UserStatusBase):
    pass

class UserStatusResponse(UserStatusBase):
    id: int
    timestamp: datetime

    class Config:
        from_attributes = True

# --- 對話紀錄儲存用 (對應 React 的 ChatMessage) ---
class ChatRecordBase(BaseModel):
    role: str # 'user' 或 'assistant'
    content: str

class ChatRecordCreate(ChatRecordBase):
    pass

class ChatRecordResponse(ChatRecordBase):
    id: int
    timestamp: datetime

    class Config:
        from_attributes = True

# --- 氣象局資料回傳格式 ---
class WeatherAlert(BaseModel):
    magnitude: float
    location: str 
    time: str
    
# --- 離線地圖用 ---
class MapBounds(BaseModel):
    min_lat: float
    max_lat: float
    min_lon: float
    max_lon: float

class MapDownloadRequest(BaseModel):
    latitude: float
    longitude: float
    radius_km: float = 5.0
    zoom_levels: List[int] = [12, 13, 14, 15, 16]
    map_id: Optional[str] = None

class MapInfoResponse(BaseModel):
    map_id: str
    center_latitude: float
    center_longitude: float
    radius_km: float
    zoom_levels: List[int]
    bounds: MapBounds
    downloaded_at: str
    status: str
    tiles_count: int

class DownloadMapResponse(BaseModel):
    success: bool
    map_id: Optional[str] = None
    message: str
    tiles_count: Optional[int] = None
    map_path: Optional[str] = None
    error: Optional[str] = None

class MapListResponse(BaseModel):
    maps: Dict[str, Any]
    count: int

class CleanupResponse(BaseModel):
    success: bool
    deleted_maps: Optional[List[str]] = None
    count: Optional[int] = None
    error: Optional[str] = None

# --- 室內地震家具風險分析 ---
class RoomRiskPoint(BaseModel):
    x: float
    y: float

class RoomRiskBBox(BaseModel):
    x: float
    y: float
    width: float
    height: float

class RoomRiskObject(BaseModel):
    label: str
    risk: str
    reason: str
    recommendation: str
    bbox: RoomRiskBBox

class RoomRiskZone(BaseModel):
    id: str
    type: str
    impactType: str
    label: str
    reason: str
    sourceObjectLabel: Optional[str] = None
    polygon: List[RoomRiskPoint]

class RoomRiskAnalysisResponse(BaseModel):
    summary: str
    overallRiskLevel: int
    objects: List[RoomRiskObject]
    zones: List[RoomRiskZone]

# schemas.py
class UserStatusBulk(BaseModel):
    records: List[UserStatusCreate]
