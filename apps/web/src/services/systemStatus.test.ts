import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSystemStatus } from './systemStatus';

function respond(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }));
}

afterEach(() => vi.unstubAllGlobals());

describe('getSystemStatus', () => {
  it('requests /api/system/status and returns only the n8n fields', async () => {
    respond(200, { status: 'operational', n8n: { status: 'UP', latencyMs: 42, checkedAt: '2026-01-01T00:00:00.000Z', extra: 'x' } });
    await expect(getSystemStatus()).resolves.toEqual({ n8n: { status: 'UP', latencyMs: 42, checkedAt: '2026-01-01T00:00:00.000Z' } });
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('/api/system/status');
  });

  it.each(['DOWN', 'NOT_CONFIGURED'])('accepts %s with a null latency', async (status) => {
    respond(200, { status: 'degraded', n8n: { status, latencyMs: null, checkedAt: '2026-01-01T00:00:00.000Z' } });
    await expect(getSystemStatus()).resolves.toMatchObject({ n8n: { status, latencyMs: null } });
  });

  it('rejects non-OK responses and malformed bodies with a generic error', async () => {
    respond(401, { message: 'No autenticado.' });
    await expect(getSystemStatus()).rejects.toThrow('SYSTEM_STATUS_UNAVAILABLE');
    respond(200, { n8n: { status: 'WEIRD', latencyMs: 1, checkedAt: 'x' } });
    await expect(getSystemStatus()).rejects.toThrow('SYSTEM_STATUS_UNAVAILABLE');
    respond(200, {});
    await expect(getSystemStatus()).rejects.toThrow('SYSTEM_STATUS_UNAVAILABLE');
  });
});
