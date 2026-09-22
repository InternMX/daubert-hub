import { afterEach, describe, expect, it, vi } from 'vitest';
import { listRecentActivity } from './recentActivity';

afterEach(() => vi.unstubAllGlobals());

describe('listRecentActivity', () => {
  it('requests the bounded business feed and returns its contract', async () => {
    const data = [{ type: 'PROVIDER_CREATED', category: 'PROVIDER', title: 'Proveedor creado', entity: 'NOVAPAK', context: null, occurredAt: '2026-08-25T18:00:00.000Z', actor: null }];
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
    const automation = { type: 'AUTOMATION_PARTIAL', category: 'AUTOMATION', title: 'Automatización con incidencias', entity: 'Notificaciones de pago', context: '4 listos · 1 manual', occurredAt: '2026-08-19T19:31:49.919Z', actor: null };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [automation] }), { status: 200 })));
    await expect(listRecentActivity()).resolves.toEqual([automation]);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ ...automation, category: 'UNKNOWN' }] }), { status: 200 })));
    await expect(listRecentActivity()).rejects.toThrow('RECENT_ACTIVITY_UNAVAILABLE');
  });

  it('accepts cancelled Remisiones Audi activity', async () => {
    const cancelled = { type: 'AUTOMATION_CANCELLED', category: 'AUTOMATION', title: 'Generación de remisiones cancelada', entity: 'Remisiones Audi', context: null, occurredAt: '2026-08-28T19:31:49.919Z', actor: null };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [cancelled] }), { status: 200 })));

    await expect(listRecentActivity()).resolves.toEqual([cancelled]);
  });

  it('accepts processing Caterpillar activity in the common automation contract', async () => {
    const processing = { type: 'AUTOMATION_PROCESSING', category: 'AUTOMATION', title: 'Procesando', entity: 'Remisiones Caterpillar', context: 'P5 · remision.pdf', occurredAt: '2026-09-22T20:07:00.000Z', actor: null };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [processing] }), { status: 200 })));

    await expect(listRecentActivity()).resolves.toEqual([processing]);
  });

  it.each(['PROVIDER_DEACTIVATED', 'PROVIDER_REACTIVATED', 'CONTACT_DEACTIVATED', 'CONTACT_REACTIVATED', 'DOCUMENT_SERIES_ADJUSTED'])('accepts the new %s activity type', async (type) => {
    const item = { type, category: type.startsWith('PROVIDER') ? 'PROVIDER' : type.startsWith('CONTACT') ? 'CONTACT' : 'AUTOMATION', title: 'Título', entity: 'Entidad', context: null, occurredAt: '2026-08-28T19:31:49.919Z', actor: null };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [item] }), { status: 200 })));

    await expect(listRecentActivity()).resolves.toEqual([item]);
  });

  it('accepts a fully populated actor and never fabricates one that is missing from the response', async () => {
    const item = { type: 'CONTACT_DEACTIVATED', category: 'CONTACT', title: 'Contacto desactivado', entity: 'Ana', context: 'Acme', occurredAt: '2026-08-28T19:31:49.919Z', actor: { id: '42', displayName: 'Alejandro López', email: 'historic@test.mx' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [item] }), { status: 200 })));

    await expect(listRecentActivity()).resolves.toEqual([item]);
  });

  it('accepts an actor with a null displayName, falling back to the historical email later at render time', async () => {
    const item = { type: 'CONTACT_DEACTIVATED', category: 'CONTACT', title: 'Contacto desactivado', entity: 'Ana', context: 'Acme', occurredAt: '2026-08-28T19:31:49.919Z', actor: { id: '42', displayName: null, email: 'historic@test.mx' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [item] }), { status: 200 })));

    await expect(listRecentActivity()).resolves.toEqual([item]);
  });

  it('rejects an item missing the actor field entirely', async () => {
    const item = { type: 'CONTACT_DEACTIVATED', category: 'CONTACT', title: 'Contacto desactivado', entity: 'Ana', context: 'Acme', occurredAt: '2026-08-28T19:31:49.919Z' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [item] }), { status: 200 })));

    await expect(listRecentActivity()).rejects.toThrow('RECENT_ACTIVITY_UNAVAILABLE');
  });

  it('rejects a malformed actor shape', async () => {
    const item = { type: 'CONTACT_DEACTIVATED', category: 'CONTACT', title: 'Contacto desactivado', entity: 'Ana', context: 'Acme', occurredAt: '2026-08-28T19:31:49.919Z', actor: { id: 42 } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [item] }), { status: 200 })));

    await expect(listRecentActivity()).rejects.toThrow('RECENT_ACTIVITY_UNAVAILABLE');
  });
});
