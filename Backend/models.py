from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from database import Base
import datetime

class UserStatus(Base):
    __tablename__ = "user_status"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String) 
    heart_rate = Column(Integer)
    battery_level = Column(Float)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)

class ChatRecord(Base):
    __tablename__ = "chat_history"
    id = Column(Integer, primary_key=True, index=True)
    role = Column(String) # 'user' or 'assistant'
    content = Column(String)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    
class UserStatus(Base):
    __tablename__ = "user_status"
    id = Column(Integer, primary_key=True, index=True)
    # ... 其他欄位 ...
    # 這裡要改成接收前端的時間，而不是 default=datetime.utcnow
    client_timestamp = Column(DateTime, nullable=True) 
    server_timestamp = Column(DateTime, default=datetime.datetime.utcnow)