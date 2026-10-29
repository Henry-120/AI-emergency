"""受難者目前的狀況（condition）：把本人回報和 AI 對話推斷合成一個。

condition 是「人怎麼了」（受困、受傷、需要物資、已安全…），
跟救援端的處理進度（待處理、已派遣…）是不同的東西。

規則：
- 本人在災情地圖或對話按鈕選的狀況是明確的訊號。
- AI 從對話推斷的狀況只能往嚴重的方向蓋過本人回報：本人回報之後，AI 從新的對話
  判斷出更嚴重的狀況就採用 AI；AI 判斷比較輕微時不降級，免得使用者問了別的問題，
  人就從救援端的地圖上消失。
- 本人沒回報時才用 AI 推斷，判斷要不要救援也沿用原本 AI 的規則。

這裡只有純計算，不碰 Firestore，方便單元測試。
"""

from datetime import datetime

# 使用者自己能選的狀況（災情地圖上的五個按鈕）。
SELF_CONDITIONS = ("trapped", "injured", "need_supplies", "safe", "helping")
# 「需要協助」只會由 AI 推斷：內容不明，但確定需要救援。
NEEDS_HELP = {"trapped", "injured", "need_help", "need_supplies"}
SEVERITY = {
    "safe": 0,
    "helping": 0,
    "need_supplies": 1,
    "need_help": 2,
    "injured": 2,
    "trapped": 3,
}


def ai_condition(case: dict) -> str | None:
    """從 AI 彙整的傷勢欄位推斷狀況；沒有 AI 資料時回 None。"""
    if case.get("isTrapped"):
        return "trapped"
    if case.get("hasInjuries") or case.get("injurySeverity") in {"moderate", "severe", "critical"}:
        return "injured"
    if case.get("rescueNeeds") or (case.get("urgencyLevel") or 1) >= 7:
        return "need_help"
    return None


def ai_requires_rescue(case: dict) -> bool:
    """原本 AI 彙整就在用的救援判斷。"""
    return bool(
        case.get("isTrapped")
        or case.get("rescueNeeds")
        or case.get("injurySeverity") in {"severe", "critical"}
        or (case.get("urgencyLevel") or 1) >= 7
    )


def effective_condition(case: dict) -> tuple[str | None, str | None, datetime | None]:
    """回傳（目前狀況, 來源, 這個狀況的時間）。來源是 self 或 ai。"""
    ai = ai_condition(case)
    ai_at = case.get("aiUpdatedAt")
    own, own_at = case.get("selfCondition"), case.get("selfConditionAt")
    if own not in SELF_CONDITIONS or not own_at:
        return (ai, "ai", ai_at) if ai else (None, None, None)
    if ai and ai_at and ai_at > own_at and SEVERITY[ai] > SEVERITY[own]:
        return ai, "ai", ai_at
    return own, "self", own_at


def requires_rescue(case: dict) -> bool:
    condition, source, _ = effective_condition(case)
    if source == "self":
        return condition in NEEDS_HELP
    return ai_requires_rescue(case)
