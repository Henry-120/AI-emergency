import hashlib
import math

from .. import schemas


class EarthquakeResponseService:
    """以可驗證的座標與距離規則產生第一時間應變，不把生命安全交給模型猜測。"""

    @staticmethod
    def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        radius = 6371.0
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        value = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
        return radius * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))

    def assess(self, data: schemas.EarthquakeAssessmentRequest) -> dict:
        distance = self._distance_km(
            data.user_latitude,
            data.user_longitude,
            data.epicenter_latitude,
            data.epicenter_longitude,
        )

        if distance <= 20:
            zone = "epicentral"
            distance_action = "您位於近震央高風險區；留在掩護處，防範強烈餘震與建物掉落物。"
        elif distance <= 50:
            zone = "near"
            distance_action = "您距震央很近；搖晃停止前勿移動，停止後避開受損外牆與招牌。"
        elif distance <= 100:
            zone = "affected"
            distance_action = "您在可能有感範圍；先就地掩護，搖晃停止後檢查出口、瓦斯與電線。"
        else:
            zone = "distant"
            distance_action = "您距震央較遠；保持警戒並確認周遭安全，不要為查看災情冒險移動。"

        actions = [
            "正在搖晃時立即趴下、掩護頭頸、抓穩固定物。",
            distance_action,
            "搖晃停止後穿鞋、檢查自己與同伴傷勢，必要時撥打 119 或 112。",
        ]
        if data.battery_level is not None and data.battery_level <= 20:
            actions.append("手機電量偏低；開啟低耗電模式，保留電力供求救與災情回報。")
        if data.heart_rate is not None and (data.heart_rate >= 120 or 0 < data.heart_rate <= 50):
            actions.append("心率讀值異常；先坐下確認身體狀況，若胸痛、昏厥或呼吸困難立即求救。")
        if data.medical_summary.strip():
            actions.append("若必須撤離，請攜帶必要藥物與醫療裝置；不要返回危險區取物。")

        raw_key = f"{data.origin_time}|{data.magnitude}|{data.location}|{data.epicenter_latitude}|{data.epicenter_longitude}"
        earthquake_key = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()[:24]
        return {
            "earthquake_key": earthquake_key,
            "distance_km": round(distance, 1),
            "impact_zone": zone,
            "immediate_actions": actions,
            "environmental_warnings": [],
            "safety_question": "請先確認：您本人與身邊的人目前是否安全？",
            "field_report_questions": [
                "附近建物有無倒塌、裂縫或掉落物？",
                "道路、橋梁、電力、瓦斯或通訊是否異常？",
                "是否看到火災、淹水、落石或其他危險？",
                "附近是否有人受傷、受困或需要救援？",
            ],
        }


earthquake_response_service = EarthquakeResponseService()
