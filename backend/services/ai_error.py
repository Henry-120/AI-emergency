"""Safe diagnostic fields: never include URLs, prompts, or raw model output."""
import logging
import httpx


def ai_error_info(error: Exception) -> dict:
    status = error.response.status_code if isinstance(error, httpx.HTTPStatusError) else None
    code = 'HTTP_ERROR' if status else 'TIMEOUT' if isinstance(error, httpx.TimeoutException) else 'NETWORK_ERROR' if isinstance(error, httpx.HTTPError) else 'INVALID_RESPONSE'
    if status:
        try:
            candidate = error.response.json().get('error', {}).get('status')
            if isinstance(candidate, str) and candidate.replace('_', '').isalnum() and len(candidate) < 80:
                code = candidate
        except (ValueError, AttributeError):
            pass
    return {'http_status': status, 'code': code, 'error_type': type(error).__name__}


def log_ai_error(feature: str, error: Exception) -> dict:
    info = ai_error_info(error)
    logging.getLogger(__name__).error('AI failure feature=%s details=%s', feature, info)
    return info
