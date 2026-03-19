from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

# --- 用戶狀態同步用 (對應 React 的 UserStatus) ---
class UserStatusBase(BaseModel):
    user_id: str 
    heart_rate: int
    battery_level: float
    latitude: Optional[float] = None
    longitude: Optional[float] = None

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
    
# schemas.py
class UserStatusBulk(BaseModel):
    records: List[UserStatusCreate]