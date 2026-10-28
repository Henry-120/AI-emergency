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

        # 這是「應變優先級」，不是 CWA 震度或災損預報。以可解釋的
        # 規則先產生保守建議，避免把攸關安全的判斷完全交給語言模型。
        if distance <= 20:
            zone = "epicentral"
            distance_action = "您位於近震央高風險區；留在掩護處，防範強烈餘震與建物掉落物。"
            distance_score = 4
        elif distance <= 50:
            zone = "near"
            distance_action = "您距震央很近；搖晃停止前勿移動，停止後避開受損外牆與招牌。"
            distance_score = 3
        elif distance <= 100:
            zone = "affected"
            distance_action = "您在可能有感範圍；先就地掩護，搖晃停止後檢查出口、瓦斯與電線。"
            distance_score = 2
        else:
            zone = "distant"
            distance_action = "您距震央較遠；保持警戒並確認周遭安全，不要為查看災情冒險移動。"
            distance_score = 1

        if data.magnitude >= 7:
            magnitude_band, magnitude_score = "極強地震", 3
        elif data.magnitude >= 6:
            magnitude_band, magnitude_score = "強震", 2
        elif data.magnitude >= 5:
            magnitude_band, magnitude_score = "顯著有感地震", 1
        else:
            magnitude_band, magnitude_score = "有感地震", 0

        if data.depth is None:
            depth_band, depth_score = "深度未提供", 0
        elif data.depth <= 35:
            depth_band, depth_score = "淺層地震", 1
        elif data.depth <= 70:
            depth_band, depth_score = "中層地震", 0
        else:
            depth_band, depth_score = "較深層地震", 0

        risk_score = distance_score + magnitude_score + depth_score
        if risk_score >= 7:
            risk_level = "critical"
        elif risk_score >= 5:
            risk_level = "high"
        elif risk_score >= 3:
            risk_level = "elevated"
        else:
            risk_level = "guarded"

        risk_label = {
            "critical": "極高",
            "high": "高",
            "elevated": "提高",
            "guarded": "一般警戒",
        }[risk_level]

        risk_summary = (
            f"距震央 {distance:.1f} 公里、規模 {data.magnitude:.1f}（{magnitude_band}）"
            f"、{depth_band}；目前應變優先級為{risk_label}。"
        )

        actions = [
            "正在搖晃時立即趴下、掩護頭頸、抓穩固定物。",
            distance_action,
            "搖晃停止後穿鞋、檢查自己與同伴傷勢，必要時撥打 119 或 112。",
        ]
        if data.magnitude >= 6 or (data.depth is not None and data.depth <= 35 and distance <= 100):
            actions.append("此事件可能有較明顯餘震；先遠離外牆、招牌與受損建物，勿急著返家。")
        if data.battery_level is not None and data.battery_level <= 20:
            actions.append("手機電量偏低；開啟低耗電模式，保留電力供求救與災情回報。")
        if data.heart_rate is not None and (data.heart_rate >= 120 or 0 < data.heart_rate <= 50):
            actions.append("心率讀值異常；先坐下確認身體狀況，若胸痛、昏厥或呼吸困難立即求救。")
        if data.medical_summary.strip():
            actions.append("若必須撤離，請攜帶必要藥物與醫療裝置；不要返回危險區取物。")

        if data.source_event_id and data.origin_time:
            # 保留 CWA 官方報告編號，並加上發震時間防止編號重用造成事件碰撞。
            earthquake_key = f"cwa:{data.source_event_id}:{data.origin_time}"
        else:
            raw_key = f"{data.origin_time}|{data.magnitude}|{data.location}|{data.epicenter_latitude}|{data.epicenter_longitude}"
            earthquake_key = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()[:24]
        return {
            "earthquake_key": earthquake_key,
            "distance_km": round(distance, 1),
            "impact_zone": zone,
            "risk_level": risk_level,
            "risk_summary": risk_summary,
            "magnitude_band": magnitude_band,
            "depth_band": depth_band,
            # 此專案目前未串接 CWA 海嘯警報來源；unknown 絕不可被解讀為「沒有警報」。
            "official_tsunami_status": "unknown",
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
