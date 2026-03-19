from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session
from database import SessionLocal, engine
import models, schemas
from services.cwa_service import CWAService
import os

models.Base.metadata.create_all(bind=engine)
app = FastAPI()
cwa = CWAService(api_key=os.getenv("CWA_API_KEY"))

# 取得資料庫連線
def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()

@app.get("/api/weather/latest")
async def get_weather():
    return await cwa.get_latest_alert()

@app.post("/api/sync/status")
async def sync_status(status: schemas.UserStatusCreate, db: Session = Depends(get_db)):
    new_status = models.UserStatus(**status.dict())
    db.add(new_status)
    db.commit()
    return {"status": "saved"}


@app.post("/api/sync/bulk_status")
def sync_bulk_status(data: schemas.UserStatusBulk, db: Session = Depends(get_db)):
    for item in data.records:
        db_status = models.UserStatus(**item.dict())
        db.add(db_status)
    db.commit()
    return {"message": f"Successfully synced {len(data.records)} records"}