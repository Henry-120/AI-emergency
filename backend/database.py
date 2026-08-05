import os

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker, declarative_base


SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./guardia_ai.db")

# connect_args={"check_same_thread": False} 僅對 SQLite 是必需的
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def run_lightweight_migrations():
    """補上 create_all 不會處理的舊 SQLite 資料庫欄位。"""
    if engine.dialect.name != "sqlite":
        return
    inspector = inspect(engine)
    if "chat_history" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("chat_history")}
    if "emergency_report_id" not in columns:
        with engine.begin() as connection:
            connection.execute(text(
                "ALTER TABLE chat_history ADD COLUMN emergency_report_id INTEGER "
                "REFERENCES emergency_reports(id)"
            ))
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_chat_history_emergency_report_id "
                "ON chat_history (emergency_report_id)"
            ))
