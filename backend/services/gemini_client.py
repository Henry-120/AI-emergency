"""呼叫 Gemini generateContent；主模型忙線或額度用完時，自動改試下一個模型。

免費方案的額度是「每個模型各自計算」（例如 GenerateRequestsPerDayPerProjectPerModel），
主模型回 429（額度／速率）或 503（忙線）時，換一個模型通常就能馬上成功；
404 代表這把 key 用不到該模型，同樣直接跳過。逾時不換模型，避免總等待時間倍增。
"""

import logging
import os

import httpx

logger = logging.getLogger(__name__)

GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
RETRYABLE_STATUS = {404, 429, 500, 503}
DEFAULT_FALLBACK_MODELS = "gemini-2.5-flash,gemini-flash-lite-latest"


def candidate_models(primary: str) -> list[str]:
    """主模型在前，後面接 GEMINI_FALLBACK_MODELS；去除空值與重複、保留順序。"""
    fallbacks = os.getenv("GEMINI_FALLBACK_MODELS", DEFAULT_FALLBACK_MODELS).split(",")
    models = [primary.strip(), *(m.strip() for m in fallbacks)]
    return list(dict.fromkeys(m for m in models if m))


async def generate_content(api_key: str, primary_model: str, payload: dict, timeout: float) -> httpx.Response:
    """依序嘗試候選模型，回傳第一個成功的回應；全部失敗時丟出最後一個 HTTP 錯誤。"""
    models = candidate_models(primary_model)
    if not models:
        raise ValueError("沒有可用的 Gemini 模型名稱")

    last_error: httpx.HTTPStatusError | None = None
    async with httpx.AsyncClient(timeout=timeout) as client:
        for model in models:
            response = await client.post(
                GEMINI_ENDPOINT.format(model=model),
                params={"key": api_key},
                json=payload,
            )
            try:
                response.raise_for_status()
                return response
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code not in RETRYABLE_STATUS:
                    raise
                logger.warning("Gemini 模型 %s 回應 %s，改試下一個模型", model, exc.response.status_code)
                last_error = exc
    raise last_error
