import asyncio
import logging

import httpx

logger = logging.getLogger(__name__)

RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}
MAX_GEMINI_ATTEMPTS = 3


async def post_gemini_with_retry(
    client: httpx.AsyncClient,
    endpoint: str,
    *,
    params: dict,
    json_body: dict,
    operation: str,
) -> httpx.Response:
    """Retry only transient Gemini overload, gateway, and transport failures."""
    for attempt in range(1, MAX_GEMINI_ATTEMPTS + 1):
        try:
            response = await client.post(endpoint, params=params, json=json_body)
        except httpx.TransportError as exc:
            if attempt == MAX_GEMINI_ATTEMPTS:
                raise
            delay = 0.4 * (2 ** (attempt - 1))
            logger.warning(
                "%s Gemini transport error on attempt %s/%s; retrying in %.1fs: %s",
                operation,
                attempt,
                MAX_GEMINI_ATTEMPTS,
                delay,
                type(exc).__name__,
            )
            await asyncio.sleep(delay)
            continue

        if response.status_code not in RETRYABLE_STATUS_CODES:
            response.raise_for_status()
            return response

        if attempt == MAX_GEMINI_ATTEMPTS:
            response.raise_for_status()

        retry_after = response.headers.get("Retry-After", "")
        try:
            delay = min(2.0, max(0.0, float(retry_after)))
        except ValueError:
            delay = 0.4 * (2 ** (attempt - 1))
        logger.warning(
            "%s Gemini returned HTTP %s on attempt %s/%s; retrying in %.1fs",
            operation,
            response.status_code,
            attempt,
            MAX_GEMINI_ATTEMPTS,
            delay,
        )
        await asyncio.sleep(delay)

    raise RuntimeError("Gemini retry loop ended unexpectedly")
