/** Log status only; do not print request bodies, credentials, or medical data. */
export async function aiFetch(feature: string, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    const response = await fetch(input, init);
    if (!response.ok) console.error('[AI]', { feature, http_status: response.status,
      code: response.headers.get('X-AI-Error-Code') || 'HTTP_ERROR',
      model_http_status: response.headers.get('X-AI-HTTP-Status') || null });
    else {
      const data = await response.clone().json().catch(() => null);
      if (data?.ai_error) console.error('[AI]', { feature, ...data.ai_error });
    }
    return response;
  } catch (error) {
    console.error('[AI]', { feature, code: init?.signal?.aborted ? 'TIMEOUT_OR_ABORTED' : 'NETWORK_ERROR',
      error_type: error instanceof Error ? error.name : 'UNKNOWN' });
    throw error;
  }
}
