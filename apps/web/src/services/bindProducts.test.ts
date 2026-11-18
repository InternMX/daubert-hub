import { afterEach, describe, expect, it, vi } from 'vitest';
import { schfpmg001 } from '../test/bindProductFixtures';
import { BindProductApiError, lookupBindProductByCode } from './bindProducts';

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('lookupBindProductByCode', () => {
  it('consulta únicamente el endpoint del backend de Daubert Hub (nunca BIND) y devuelve los datos', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { data: schfpmg001() }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await lookupBindProductByCode(' SCHFPMG001 ');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/manufacturing-sheets/bind-products/by-code/SCHFPMG001');
    expect(String(url)).not.toMatch(/bind\.com\.mx|Bearer|apikey/i);
    expect(JSON.stringify(init ?? {})).not.toMatch(/Authorization|Ocp-Apim/i);
    expect(result.producto.Code).toBe('SCHFPMG001');
    expect(result.especificacionConfirmada).toBe(false);
  });

  it.each([[400, 'INVALID_CODE'], [401, 'UNAUTHENTICATED'], [403, 'FORBIDDEN'], [404, 'NOT_FOUND'], [409, 'MULTIPLE_MATCHES'], [502, 'BIND_UNAVAILABLE'], [503, 'RATE_LIMITED'], [504, 'TIMEOUT']])(
    'traduce HTTP %i a %s',
    async (status, kind) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(status, { message: 'detalle interno' })));
      await expect(lookupBindProductByCode('SCHFPMG001')).rejects.toMatchObject({ kind, status });
    }
  );

  it.each(["X' or 1", 'A B', 'A/B', '', 'A'.repeat(65)])('rechaza el código %j sin llamar al servidor', async (code) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(lookupBindProductByCode(code)).rejects.toBeInstanceOf(BindProductApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('error de red y respuesta con formato inesperado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));
    await expect(lookupBindProductByCode('SCHFPMG001')).rejects.toMatchObject({ kind: 'NETWORK' });
    for (const body of [null, {}, { data: {} }, { data: { origen: 'BIND', producto: { Code: 'X' } } }]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, body)));
      await expect(lookupBindProductByCode('SCHFPMG001')).rejects.toMatchObject({ kind: 'INVALID_RESPONSE' });
    }
  });

  it('propaga la cancelación de la solicitud', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));
    await expect(lookupBindProductByCode('SCHFPMG001')).rejects.toMatchObject({ name: 'AbortError' });
  });
});
