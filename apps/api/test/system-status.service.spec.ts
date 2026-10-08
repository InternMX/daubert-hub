import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemStatusService } from '../src/system/system-status.service';

const URL_VALUE = 'http://host.docker.internal:5678/webhook/daubert-hub/health';
const TOKEN = 'super-secret-token';

function configWith(overrides: Partial<{ url: string | null; token: string | null }> = {}) {
  return { get: vi.fn().mockReturnValue({ url: URL_VALUE, token: TOKEN, ...overrides }) };
}

describe('SystemStatusService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reports UP / operational with a latency when n8n answers 2xx', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 }) as never;
    const result = await new SystemStatusService(configWith() as never).getStatus();

    expect(result.status).toBe('operational');
    expect(result.n8n.status).toBe('UP');
    expect(result.n8n.latencyMs).toEqual(expect.any(Number));
    expect(result.n8n.latencyMs).toBeGreaterThanOrEqual(0);
    expect(new Date(result.n8n.checkedAt).toISOString()).toBe(result.n8n.checkedAt);
  });

  it.each([403, 404, 500])('reports DOWN / degraded when n8n answers %i', async (status) => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status }) as never;
    const result = await new SystemStatusService(configWith() as never).getStatus();
    expect(result).toMatchObject({ status: 'degraded', n8n: { status: 'DOWN', latencyMs: null } });
  });

  it('reports DOWN on a network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed: ECONNREFUSED')) as never;
    const result = await new SystemStatusService(configWith() as never).getStatus();
    expect(result).toMatchObject({ status: 'degraded', n8n: { status: 'DOWN', latencyMs: null } });
  });

  it('aborts after ~3 seconds and reports DOWN on timeout', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    global.fetch = fetchMock as never;
    const pending = new SystemStatusService(configWith() as never).getStatus();

    await vi.advanceTimersByTimeAsync(2_999);
    expect(fetchMock.mock.calls[0]![1].signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toMatchObject({ status: 'degraded', n8n: { status: 'DOWN', latencyMs: null } });
  });

  it.each([
    [{ url: null }],
    [{ token: null }],
    [{ url: null, token: null }]
  ])('reports NOT_CONFIGURED without calling n8n when config is incomplete (%j)', async (overrides) => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as never;
    const result = await new SystemStatusService(configWith(overrides) as never).getStatus();
    expect(result).toMatchObject({ status: 'degraded', n8n: { status: 'NOT_CONFIGURED', latencyMs: null } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a GET with the X-Daubert-Automation-Token header to the configured URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as never;
    await new SystemStatusService(configWith() as never).getStatus();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(URL_VALUE);
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['X-Daubert-Automation-Token']).toBe(TOKEN);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('never leaks the token, the URL or the underlying error in any outcome', async () => {
    const arrangements = [
      () => vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      () => vi.fn().mockResolvedValue({ ok: false, status: 500 }),
      () => vi.fn().mockRejectedValue(new Error(`boom ${URL_VALUE} ${TOKEN}`))
    ];
    for (const arrange of arrangements) {
      global.fetch = arrange() as never;
      const serialized = JSON.stringify(await new SystemStatusService(configWith() as never).getStatus());
      expect(serialized).not.toContain(TOKEN);
      expect(serialized).not.toContain('host.docker.internal');
      expect(serialized).not.toContain('boom');
    }
  });
});
