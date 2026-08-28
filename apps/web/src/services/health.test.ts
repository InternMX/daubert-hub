import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRuntimeEnvironment } from './health';

afterEach(() => vi.unstubAllGlobals());

describe('health service', () => {
  it.each(['PRODUCTION', 'TEST', 'UNKNOWN'] as const)('reads the %s environment from API health', async (environment) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'ok', database: 'connected', environment
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getRuntimeEnvironment()).resolves.toBe(environment);
    expect(fetchMock).toHaveBeenCalledWith('/api/health');
  });

  it('rejects a health response without a safe runtime environment', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'ok', database: 'unavailable'
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    await expect(getRuntimeEnvironment()).rejects.toThrow('HEALTH_UNAVAILABLE');
  });
});
