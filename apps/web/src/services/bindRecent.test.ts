import { afterEach, describe, expect, it, vi } from 'vitest';
import { listBindRecent } from './bindRecent';

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) });
const pagina = { items: [{ code: 'A1', title: 'T', fechaAlta: '2026-10-22', familiaSugerida: 'BOLSA_PLANA_1', motivo: 'm', compatibilidad: 'COMPATIBLE' }], skip: 0, limit: 30, nextSkip: null, generadoEn: '2026-10-29T18:00:00.000Z', desdeCache: false };

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('listBindRecent', () => {
  it('consulta solo el backend de Daubert Hub con skip, limit y refresh; nunca BIND ni credenciales', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { data: pagina }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await listBindRecent({ skip: 30, limit: 30, refresh: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/manufacturing-sheets/bind-products/recent?skip=30&limit=30&refresh=1');
    expect(String(url)).not.toMatch(/bind\.com\.mx|Bearer|apikey/i);
    expect(JSON.stringify(init ?? {})).not.toMatch(/Authorization|Ocp-Apim/i);
    expect(r.items[0]!.code).toBe('A1');
    await listBindRecent();
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/manufacturing-sheets/bind-products/recent?skip=0&limit=30');
  });

  it.each([[401, 'UNAUTHENTICATED'], [403, 'FORBIDDEN'], [502, 'BIND_UNAVAILABLE'], [503, 'RATE_LIMITED'], [504, 'TIMEOUT'], [500, 'BIND_UNAVAILABLE']])('traduce HTTP %i a %s', async (status, kind) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(status, { message: 'detalle interno' })));
    await expect(listBindRecent()).rejects.toMatchObject({ kind, status });
  });

  it('una respuesta con forma inesperada es INVALID_RESPONSE y un fallo de red es NETWORK; la cancelación se propaga', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { data: { ...pagina, items: [{ code: 1 }] } })));
    await expect(listBindRecent()).rejects.toMatchObject({ kind: 'INVALID_RESPONSE' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { data: { ...pagina, items: [{ ...pagina.items[0], compatibilidad: 'OTRA' }] } })));
    await expect(listBindRecent()).rejects.toMatchObject({ kind: 'INVALID_RESPONSE' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')));
    await expect(listBindRecent()).rejects.toMatchObject({ kind: 'NETWORK' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('abort', 'AbortError')));
    await expect(listBindRecent()).rejects.toMatchObject({ name: 'AbortError' });
  });
});
