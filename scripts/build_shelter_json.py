import csv
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
CSV_FILE = ROOT / "data" / "shelters" / "shelters_official.csv"
JSON_FILE = ROOT / "data" / "shelters" / "taiwan_shelters.json"


def to_float(value):
    try:
        if value in (None, ""):
            return None
        return float(value)
    except ValueError:
        return None


def to_int(value):
    try:
        if value in (None, ""):
            return None
        return int(float(value))
    except ValueError:
        return None


def split_city_town(value):
    if not value:
        return "", ""
    counties = ["新竹縣", "苗栗縣", "彰化縣", "南投縣", "雲林縣", "嘉義縣", "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣", "金門縣", "連江縣"]
    cities = ["基隆市", "臺北市", "新北市", "桃園市", "新竹市", "臺中市", "嘉義市", "臺南市", "高雄市"]
    for prefix in cities + counties:
        if value.startswith(prefix):
            return prefix, value[len(prefix):]
    return value[:3], value[3:]


def main():
    shelters = []
    with CSV_FILE.open(encoding="utf-8-sig", newline="") as file:
        for row in csv.DictReader(file):
            lat = to_float(row.get("緯度"))
            lon = to_float(row.get("經度"))
            if lat is None or lon is None:
                continue

            city, town = split_city_town(row.get("縣市及鄉鎮市區", ""))
            name = row.get("避難收容處所名稱") or "未命名避難所"
            shelter_id = row.get("序號") or f"{name}-{lat:.6f}-{lon:.6f}"

            shelters.append(
                {
                    "id": f"official-{shelter_id}",
                    "name": name,
                    "city": city,
                    "town": town,
                    "village": row.get("村里") or "",
                    "address": row.get("避難收容處所地址") or "",
                    "lat": lat,
                    "lon": lon,
                    "open_status": "",
                    "disaster_type": row.get("適用災害類別") or "",
                    "capacity": to_int(row.get("預計收容人數")),
                    "contact_name": row.get("管理人姓名") or "",
                    "contact_phone": row.get("管理人電話") or "",
                    "indoor": row.get("室內") == "是",
                    "outdoor": row.get("室外") == "是",
                    "accessible": row.get("適合避難弱者安置") == "是",
                    "planned_villages": row.get("預計收容村里") or "",
                    "last_update_time": "",
                }
            )

    JSON_FILE.write_text(
        json.dumps(
            {
                "source": "內政部消防署 避難收容處所點位檔",
                "count": len(shelters),
                "shelters": shelters,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Wrote {len(shelters)} shelters to {JSON_FILE}")


if __name__ == "__main__":
    main()
