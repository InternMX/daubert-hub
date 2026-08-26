import { afterEach, describe, expect, it, vi } from 'vitest';
import { listRecentActivity } from './recentActivity';

afterEach(() => vi.unstubAllGlobals());

describe('listRecentActivity', () => {
  it('requests the bounded business feed and returns its contract', async () => {
    const data = [{ type: 'PROVIDER_CREATED', category: 'PROVIDER', title: 'Proveedor creado', entity: 'NOVAPAK', context: null, occurredAt: '2026-08-25T18:00:00.000Z' }];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(listRecentActivity(6)).resolves.toEqual(data);
    expect(fetchMock).toHaveBeenCalledWith('/api/recent-activity?limit=6');
  });

  it('adds an optional business category to the existing endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await listRecentActivity(6, 'AUTOMATION');

    expect(fetchMock).toHaveBeenCalledWith('/api/recent-activity?limit=6&category=AUTOMATION');
  });

  it('uses a safe error for failed or malformed responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    await expect(listRecentActivity()).rejects.toThrow('RECENT_ACTIVITY_UNAVAILABLE');
  });

  it('rejects malformed activity items before they reach Home rendering', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ type: 'PROVIDER_CREATED', occurredAt: 'not-a-date' }] }), { status: 200 })));
    await expect(listRecentActivity()).rejects.toThrow('RECENT_ACTIVITY_UNAVAILABLE');
  });

  it('accepts the automation contract and rejects unknown categories', async () => {
    const automation = { type: 'AUTOMATION_PARTIAL', category: 'AUTOMATION', title: 'Automatización con incidencias', entity: 'Notificaciones de pago', context: '4 listos · 1 manual', occurredAt: '2026-08-19T19:31:49.919Z' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [automation] }), { status: 200 })));
    await expect(listRecentActivity()).resolves.toEqual([automation]);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ ...automation, category: 'UNKNOWN' }] }), { status: 200 })));
    await expect(listRecentActivity()).rejects.toThrow('RECENT_ACTIVITY_UNAVAILABLE');
  });
});
