import { afterEach, describe, expect, it, vi } from 'vitest';
import { adjustDocumentSeries, AutomationApiError, getDocumentSeries } from './automations';

const data = { automation: { code: 'REMISIONES_AUDI', name: 'Audi', status: 'ACTIVO' }, series: { code: 'REMISION_AUDI', name: 'Remisión Audi', nextFolio: 994, status: 'ACTIVO' }, adjustments: [] };

afterEach(() => vi.unstubAllGlobals());

describe('automation service', () => {
  it('reads configuration using stable URL codes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getDocumentSeries('REMISIONES_AUDI', 'REMISION_AUDI')).resolves.toEqual(data);
    expect(fetchMock).toHaveBeenCalledWith('/api/automations/REMISIONES_AUDI/document-series/REMISION_AUDI', undefined);
  });

  it('sends the adjustment without database identifiers, including expectedCurrentFolio', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await adjustDocumentSeries('REMISIONES_AUDI', 'REMISION_AUDI', { expectedCurrentFolio: 994, nextFolio: 993, reason: 'Corrección' });
    expect(fetchMock).toHaveBeenCalledWith('/api/automations/REMISIONES_AUDI/document-series/REMISION_AUDI', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ expectedCurrentFolio: 994, nextFolio: 993, reason: 'Corrección' }) }));
  });

  it('sends backwardFilesystemAcknowledged when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await adjustDocumentSeries('REMISIONES_CATERPILLAR', 'REMISION_CAT_P5', { expectedCurrentFolio: 130, nextFolio: 124, reason: 'Corrección excepcional', backwardFilesystemAcknowledged: true });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ expectedCurrentFolio: 130, nextFolio: 124, reason: 'Corrección excepcional', backwardFilesystemAcknowledged: true });
  });

  it('surfaces the backend-sanitized message on failure instead of exposing internal details', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'SERIES_FOLIO_STALE', message: 'El folio actual cambió desde que se cargó esta pantalla. Actualiza la información e intenta de nuevo.' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(adjustDocumentSeries('REMISIONES_AUDI', 'REMISION_AUDI', { expectedCurrentFolio: 994, nextFolio: 993, reason: 'Corrección' }))
      .rejects.toMatchObject({ status: 409, code: 'SERIES_FOLIO_STALE', serverMessage: 'El folio actual cambió desde que se cargó esta pantalla. Actualiza la información e intenta de nuevo.' });
  });

  it('falls back to no serverMessage when the backend response has none', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await adjustDocumentSeries('REMISIONES_AUDI', 'REMISION_AUDI', { expectedCurrentFolio: 994, nextFolio: 993, reason: 'Corrección' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AutomationApiError);
      expect((error as AutomationApiError).serverMessage).toBeUndefined();
    }
  });
});
