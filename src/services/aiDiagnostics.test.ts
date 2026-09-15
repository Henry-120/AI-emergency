import { afterEach, expect, it, vi } from 'vitest';
import { aiFetch } from './aiDiagnostics';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('logs model errors in successful fallback responses and leaves body readable', async () => {
  const response = new Response(JSON.stringify({ ai_error: { code: 'UNAVAILABLE', http_status: 503 }, result: 'fallback' }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const result = await aiFetch('location', '/test');
  expect(log).toHaveBeenCalledWith('[AI]', { feature: 'location', code: 'UNAVAILABLE', http_status: 503 });
  expect((await result.json()).result).toBe('fallback');
});
it('distinguishes backend status from model status', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 502, headers: { 'X-AI-Error-Code': 'UNAVAILABLE', 'X-AI-HTTP-Status': '503' } })));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await aiFetch('disaster', '/test');
  expect(log).toHaveBeenCalledWith('[AI]', expect.objectContaining({ http_status: 502, model_http_status: '503', code: 'UNAVAILABLE' }));
});
