from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime
from typing import Literal

# --- 註冊 / 登入 ---
class RegisterRequest(BaseModel):
    username: str
    password: str
    email: Optional[str] = None

class LoginRequest(BaseModel):
    username: str
    password: str

class UserResponse(BaseModel):
    id: str
    username: str
    email: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

class AuthResponse(BaseModel):
    token: str
    user: UserResponse

# --- 緊急醫療卡 (ICE) ---
class MedicalCardBase(BaseModel):
    full_name: str = ""
    birthday: str = ""
    gender: str = ""
    blood_type: str = ""
    height_cm: str = ""
    weight_kg: str = ""
    drug_allergies: str = ""
    food_allergies: str = ""
    chronic_conditions: str = ""
    current_medications: str = ""
    medical_devices: str = ""
    organ_donor: bool = False
    emergency_contact_name: str = ""
    emergency_contact_phone: str = ""
    emergency_contact_relation: str = ""
    national_id: str = ""
    notes: str = ""

class MedicalCardResponse(MedicalCardBase):
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

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

# --- AI 傷勢 / 救援需求彙整 ---
class EmergencySummary(BaseModel):
    hasInjuries: bool = False
    injurySummary: str = ""
    injurySeverity: Literal["unknown", "minor", "moderate", "severe", "critical"] = "unknown"
    rescueNeeds: List[str] = Field(default_factory=list)
    isTrapped: bool = False
    mobilityStatus: Literal["unknown", "mobile", "limited", "immobile"] = "unknown"
    locationDetails: str = ""
    urgencyLevel: int = 1
    confidence: float = 0

class EmergencyChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    timestamp: Optional[datetime] = None

class EmergencyReportUpsert(BaseModel):
    summary: EmergencySummary
    messages: List[EmergencyChatMessage] = Field(default_factory=list)
    latitude: Optional[float] = None
    longitude: Optional[float] = None

class EmergencyReportResponse(EmergencySummary):
    userId: str
    updatedAt: datetime
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    requiresRescue: bool = False

class RescueCaseResponse(BaseModel):
    userId: str
    username: str
    latitude: float
    longitude: float
    distanceKm: float
    urgencyLevel: int
    injurySeverity: str
    injurySummary: str = ""
    rescueNeeds: List[str] = Field(default_factory=list)
    isTrapped: bool = False
    mobilityStatus: str = "unknown"
    locationDetails: str = ""
    updatedAt: datetime

# --- 氣象局資料回傳格式 ---
class WeatherAlert(BaseModel):
    magnitude: float
    location: str
    time: str

# --- 推播裝置註冊 ---
class DeviceTokenRegister(BaseModel):
    token: str
    platform: Literal["ios"] = "ios"

class DeviceTokenResponse(BaseModel):
    status: str
    
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

# schemas.py
class UserStatusBulk(BaseModel):
    records: List[UserStatusCreate]

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

# --- SOS 多跳中繼 ---
class SosReportRequest(BaseModel):
    """
    中繼者（有網路的那個人）把整包 SOS/ALERT 封包原封不動送來。
    packet 是 base64 的完整封包 bytes（14 bytes 明文標頭 + 加密內容），
    後端才解得開，中繼者本人也解不開自己轉發的內容。
    """
    packet: str = Field(..., description="base64 編碼的完整封包（標頭+加密內容）")

class SosReportResponse(BaseModel):
    """
    回傳一個簽章過的 ACK 封包給呼叫端（中繼者）。
    中繼者應把這個 ackPacket 當成一般的中繼封包繼續往外傳播，
    讓它有機會沿路傳回原本發送求救的裝置。
    """
    success: bool
    ack_packet: str = Field(..., description="base64 編碼的 ACK 封包，交給呼叫端繼續中繼")
    duplicate: bool = False

class SosCaseResponse(BaseModel):
    """
    給救援地圖用的求救記錄，來自藍牙多跳中繼送達的封包。

    緊急度/是否受困/位置/位置描述/電量在封包的明文標頭裡，中繼者也看得到；
    使用者名稱/傷勢摘要/救援需求/行動能力/醫療摘要在加密內容裡，只有這裡
    （已經解密過）才看得到——跟 RescueCaseResponse（AI 對話彙整）欄位刻意
    對齊，方便救援地圖用同一套邏輯呈現兩種來源。
    """
    msg_id: str
    hops: int
    urgency_level: int
    is_trapped: bool
    latitude: float
    longitude: float
    distanceKm: float
    location_details: str = ""
    battery_level: Optional[float] = None
    from_local_id: str = ""
    username: str = "未知使用者"
    injury_summary: str = ""
    rescue_needs: List[str] = Field(default_factory=list)
    mobility_status: str = "unknown"
    blood_type: str = ""
    drug_allergies: str = ""
    chronic_conditions: str = ""
    received_at: datetime
