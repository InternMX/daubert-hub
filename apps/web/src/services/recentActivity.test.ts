import { afterEach, describe, expect, it, vi } from 'vitest';
import { listRecentActivity } from './recentActivity';

afterEach(() => vi.unstubAllGlobals());

describe('listRecentActivity', () => {
  it('requests the bounded business feed and returns its contract', async () => {
    const data = [{ type: 'PROVIDER_CREATED', title: 'Proveedor creado', entity: 'NOVAPAK', context: null, occurredAt: '2026-08-25T18:00:00.000Z' }];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(listRecentActivity(6)).resolves.toEqual(data);
    expect(fetchMock).toHaveBeenCalledWith('/api/recent-activity?limit=6');
  });

  it('uses a safe error for failed or malformed responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    await expect(listRecentActivity()).rejects.toThrow('RECENT_ACTIVITY_UNAVAILABLE');
  });

  it('rejects malformed activity items before they reach Home rendering', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ type: 'PROVIDER_CREATED', occurredAt: 'not-a-date' }] }), { status: 200 })));
    await expect(listRecentActivity()).rejects.toThrow('RECENT_ACTIVITY_UNAVAILABLE');
  });
});
