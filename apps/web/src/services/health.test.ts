import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHealth, getRuntimeEnvironment } from './health';

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

  describe('getHealth (version/commit build metadata)', () => {
    it('exposes the semantic version and commit alongside the environment', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
        status: 'ok', database: 'connected', environment: 'TEST', version: '0.8.0-pilot.1', commit: 'a1b2c3d'
      }), { status: 200, headers: { 'content-type': 'application/json' } })));

      await expect(getHealth()).resolves.toEqual({ environment: 'TEST', version: '0.8.0-pilot.1', commit: 'a1b2c3d' });
    });

    it('falls back to null version/commit when missing from the response, without failing the whole call', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
        status: 'ok', database: 'connected', environment: 'TEST'
      }), { status: 200, headers: { 'content-type': 'application/json' } })));

      await expect(getHealth()).resolves.toEqual({ environment: 'TEST', version: null, commit: null });
    });

    it('falls back to null commit specifically when the backend reports "unknown" build metadata as an empty/missing value', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
        status: 'ok', database: 'connected', environment: 'TEST', version: '0.8.0-pilot.1', commit: ''
      }), { status: 200, headers: { 'content-type': 'application/json' } })));

      await expect(getHealth()).resolves.toEqual({ environment: 'TEST', version: '0.8.0-pilot.1', commit: null });
    });

    it('never derives a version/commit itself — only what the backend response carries', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
        status: 'ok', database: 'connected', environment: 'PRODUCTION', version: '9.9.9', commit: 'fedcba9'
      }), { status: 200, headers: { 'content-type': 'application/json' } })));

      const result = await getHealth();
      expect(result.version).toBe('9.9.9');
      expect(result.commit).toBe('fedcba9');
    });
  });
});
