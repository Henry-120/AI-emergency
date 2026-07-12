from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from .database import Base
import datetime


class User(Base):
    """註冊使用者帳號。密碼以 PBKDF2 雜湊後儲存，不存明碼。"""
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=True)
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    medical_card = relationship(
        "MedicalCard", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )


class MedicalCard(Base):
    """緊急醫療卡 (ICE)：在災害現場供救護人員與 AI 參考的關鍵醫療資訊。"""
    __tablename__ = "medical_cards"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)

    full_name = Column(String, default="")          # 姓名
    birthday = Column(String, default="")            # 生日 YYYY-MM-DD
    gender = Column(String, default="")              # 性別
    blood_type = Column(String, default="")          # 血型 (含 Rh)
    height_cm = Column(String, default="")           # 身高
    weight_kg = Column(String, default="")           # 體重
    drug_allergies = Column(String, default="")      # 藥物過敏
    food_allergies = Column(String, default="")      # 食物 / 其他過敏
    chronic_conditions = Column(String, default="")  # 慢性病史
    current_medications = Column(String, default="") # 目前用藥
    medical_devices = Column(String, default="")     # 體內醫療裝置 (心律調節器等)
    organ_donor = Column(Boolean, default=False)     # 器官捐贈意願
    emergency_contact_name = Column(String, default="")      # 緊急聯絡人
    emergency_contact_phone = Column(String, default="")     # 緊急聯絡電話
    emergency_contact_relation = Column(String, default="")  # 關係
    national_id = Column(String, default="")         # 身分證 / 健保資訊
    notes = Column(String, default="")               # 其他備註
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    user = relationship("User", back_populates="medical_card")


class UserStatus(Base):
    __tablename__ = "user_status"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, nullable=True)
    heart_rate = Column(Integer)
    battery_level = Column(Float)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    client_timestamp = Column(DateTime, nullable=True)
    server_timestamp = Column(DateTime, default=datetime.datetime.utcnow)

class ChatRecord(Base):
    __tablename__ = "chat_history"
    id = Column(Integer, primary_key=True, index=True)
    role = Column(String) # 'user' or 'assistant'
    content = Column(String)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    
# Note: only one UserStatus model should be defined above.