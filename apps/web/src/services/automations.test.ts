import { afterEach, describe, expect, it, vi } from 'vitest';
import { adjustDocumentSeries, getDocumentSeries } from './automations';

const data = { automation: { code: 'REMISIONES_AUDI', name: 'Audi', status: 'ACTIVO' }, series: { code: 'REMISION_AUDI', name: 'Remisión Audi', nextFolio: 994, status: 'ACTIVO' }, adjustments: [] };

afterEach(() => vi.unstubAllGlobals());

describe('automation service', () => {
  it('reads configuration using stable URL codes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getDocumentSeries('REMISIONES_AUDI', 'REMISION_AUDI')).resolves.toEqual(data);
    expect(fetchMock).toHaveBeenCalledWith('/api/automations/REMISIONES_AUDI/document-series/REMISION_AUDI', undefined);
  });

  it('sends the adjustment without database identifiers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await adjustDocumentSeries('REMISIONES_AUDI', 'REMISION_AUDI', { nextFolio: 993, reason: 'Corrección' });
    expect(fetchMock).toHaveBeenCalledWith('/api/automations/REMISIONES_AUDI/document-series/REMISION_AUDI', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ nextFolio: 993, reason: 'Corrección' }) }));
  });
});
