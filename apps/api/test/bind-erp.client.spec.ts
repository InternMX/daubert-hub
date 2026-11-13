import { afterEach, describe, expect, it, vi } from 'vitest';
import { BindErpClient, isValidBindCode, isValidBindId } from '../src/manufacturing-sheets/bind/bind-erp.client';
import type { BindClientOptions } from '../src/manufacturing-sheets/bind/bind-erp.client';

const API_KEY = 'clave-api-de-prueba-0000';
const SUB_KEY = 'clave-suscripcion-de-prueba-1111';
const GUID = 'bbe2cc0c-3498-47cb-a556-d435eba5c0b4';
const BASE = 'https://api.bind.com.mx';

const producto = (over: Record<string, unknown> = {}) => ({ ID: GUID, Code: 'SCHFPMG001', Title: 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS', Description: null, Weight: 0.0428, CreationDate: '2025-03-10T15:20:00Z', ...over });
const pagina = (value: unknown[], extra: Record<string, unknown> = {}) => ({ value, ...extra });
const ok = (body: unknown) => ({ status: 200, ok: true, json: vi.fn().mockResolvedValue(body), headers: new Headers() });
const http = (status: number, headers: Record<string, string> = {}) => ({ status, ok: false, json: vi.fn().mockResolvedValue({ message: 'detalle interno de BIND con datos sensibles', apiKey: API_KEY }), headers: new Headers(headers) });

function cliente(config: Partial<{ baseUrl: string; apiKey: string | null; subscriptionKey: string | null }> = {}, options: Partial<BindClientOptions> = {}) {
  const value = { baseUrl: BASE, apiKey: API_KEY, subscriptionKey: SUB_KEY, ...config };
  return new BindErpClient({ get: vi.fn().mockReturnValue(value) } as never, { timeoutMs: 40, totalTimeoutMs: 2_000, retryDelaysMs: [0, 0], maxRetryAfterMs: 10, maxPages: 3, ...options });
}

describe('BindErpClient', () => {
  const originalFetch = global.fetch;
  const usar = (fn: ReturnType<typeof vi.fn>) => { global.fetch = fn as never; return fn; };
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  describe('validación y construcción de la URL', () => {
    it('busca por Code con $filter exacto, codificado, solo por HTTPS y con los encabezados de BIND', async () => {
      const fetchMock = usar(vi.fn().mockResolvedValue(ok(pagina([producto()]))));
      const r = await cliente().findByCode('SCHFPMG001');
      expect(r).toMatchObject({ kind: 'RESULTS', products: [{ Code: 'SCHFPMG001' }] });
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe(`${BASE}/api/Products?$filter=Code%20eq%20'SCHFPMG001'`);
      expect(init.method).toBe('GET');
      expect(init.redirect).toBe('error');
      expect(init.headers).toEqual({ Accept: 'application/json', Authorization: `Bearer ${API_KEY}`, 'Ocp-Apim-Subscription-Key': SUB_KEY });
      expect(String(url)).not.toContain(API_KEY);
    });

    it('busca por ID con la sintaxis guid\'…\' documentada (GUID normalizado a minúsculas)', async () => {
      const fetchMock = usar(vi.fn().mockResolvedValue(ok(pagina([producto()]))));
      await cliente().findById(GUID.toUpperCase());
      expect(fetchMock.mock.calls[0]![0]).toBe(`${BASE}/api/Products?$filter=ID%20eq%20guid'${GUID}'`);
    });

    it('omite Ocp-Apim-Subscription-Key cuando no está configurada', async () => {
      const fetchMock = usar(vi.fn().mockResolvedValue(ok(pagina([producto()]))));
      await cliente({ subscriptionKey: null }).findByCode('SCHFPMG001');
      expect(fetchMock.mock.calls[0]![1].headers).not.toHaveProperty('Ocp-Apim-Subscription-Key');
    });

    it.each(["X' or '1'='1", 'A B', 'A/B', 'A"B', 'A;B', '', ' ', 'A'.repeat(65), 'ÁÉ', 'A%27B', '$filter'])('rechaza el código %j sin llamar a BIND', async (code) => {
      const fetchMock = usar(vi.fn());
      expect(await cliente().findByCode(code)).toEqual({ kind: 'BAD_REQUEST' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(['no-es-guid', GUID + "' or 1 eq 1", `guid'${GUID}'`, '', GUID.slice(1)])('rechaza el ID %j sin llamar a BIND', async (id) => {
      const fetchMock = usar(vi.fn());
      expect(await cliente().findById(id)).toEqual({ kind: 'BAD_REQUEST' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('expone los validadores de entrada', () => {
      expect(isValidBindCode('SCHFPMG001')).toBe(true);
      expect(isValidBindCode("a'b")).toBe(false);
      expect(isValidBindId(GUID)).toBe(true);
      expect(isValidBindId('x')).toBe(false);
    });

    it('sin BIND_API_KEY informa NOT_CONFIGURED y no llama a BIND', async () => {
      const fetchMock = usar(vi.fn());
      expect(await cliente({ apiKey: null }).findByCode('SCHFPMG001')).toEqual({ kind: 'NOT_CONFIGURED' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('resultados', () => {
    it('producto encontrado por código y por ID, proyectando solo los seis campos (sin precios ni costos)', async () => {
      usar(vi.fn().mockResolvedValue(ok(pagina([producto({ Price: 99.5, Cost: 10, Stock: 3, Inventory: { x: 1 } })]))));
      const porCodigo = await cliente().findByCode('schfpmg001');
      expect(porCodigo).toEqual({ kind: 'RESULTS', products: [producto()] });
      expect(JSON.stringify(porCodigo)).not.toMatch(/Price|Cost|Stock|Inventory/);
      const porId = await cliente().findById(GUID);
      expect(porId).toMatchObject({ kind: 'RESULTS', products: [{ ID: GUID }] });
    });

    it('acepta un arreglo directo (variante del ejemplo de la documentación)', async () => {
      usar(vi.fn().mockResolvedValue(ok([producto()])));
      expect(await cliente().findByCode('SCHFPMG001')).toMatchObject({ kind: 'RESULTS', products: [{ Code: 'SCHFPMG001' }] });
    });

    it('producto no encontrado: resultado vacío', async () => {
      usar(vi.fn().mockResolvedValue(ok(pagina([]))));
      expect(await cliente().findByCode('NOEXISTE001')).toEqual({ kind: 'RESULTS', products: [] });
    });

    it('conserva Weight = 0 tal cual (la interpretación decide qué hacer con él)', async () => {
      usar(vi.fn().mockResolvedValue(ok(pagina([producto({ Weight: 0 })]))));
      expect(await cliente().findByCode('SCHFPMG001')).toMatchObject({ products: [{ Weight: 0 }] });
    });

    it('múltiples coincidencias: las devuelve todas, sin elegir una y sin seguir paginando', async () => {
      const fetchMock = usar(vi.fn().mockResolvedValue(ok(pagina([producto(), producto({ ID: '11111111-2222-3333-4444-555555555555' })], { nextLink: `${BASE}/api/Products?$skip=2` }))));
      const r = await cliente().findByCode('SCHFPMG001');
      expect(r).toMatchObject({ kind: 'RESULTS' });
      expect((r as { products: unknown[] }).products).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('si BIND ignora el filtro y devuelve otros productos, no lo oculta como «no encontrado» ni elige uno', async () => {
      usar(vi.fn().mockResolvedValue(ok(pagina([producto({ Code: 'OTRO001' }), producto({ Code: 'OTRO002' })]))));
      expect(await cliente().findByCode('SCHFPMG001')).toEqual({ kind: 'INVALID_RESPONSE' });
    });
  });

  describe('errores y reintentos', () => {
    it.each([[400, 'BAD_REQUEST'], [401, 'UNAUTHORIZED'], [403, 'FORBIDDEN']])('HTTP %i no se reintenta', async (status, kind) => {
      const fetchMock = usar(vi.fn().mockResolvedValue(http(status)));
      const r = await cliente().findByCode('SCHFPMG001');
      expect(r).toEqual({ kind });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(r)).not.toMatch(/detalle interno|clave-api/);
    });

    it('HTTP 429 se reintenta de forma limitada y se informa RATE_LIMITED con Retry-After', async () => {
      const fetchMock = usar(vi.fn().mockResolvedValue(http(429, { 'Retry-After': '1' })));
      expect(await cliente().findByCode('SCHFPMG001')).toEqual({ kind: 'RATE_LIMITED', retryAfterSeconds: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('HTTP 429 seguido de éxito se recupera', async () => {
      const fetchMock = usar(vi.fn().mockResolvedValueOnce(http(429)).mockResolvedValueOnce(ok(pagina([producto()]))));
      expect(await cliente().findByCode('SCHFPMG001')).toMatchObject({ kind: 'RESULTS' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('HTTP 500 se reintenta (máximo dos reintentos) y luego UPSTREAM_ERROR', async () => {
      const fetchMock = usar(vi.fn().mockResolvedValue(http(500)));
      expect(await cliente().findByCode('SCHFPMG001')).toEqual({ kind: 'UPSTREAM_ERROR' });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('HTTP 503 seguido de éxito se recupera', async () => {
      usar(vi.fn().mockResolvedValueOnce(http(503)).mockResolvedValueOnce(ok(pagina([producto()]))));
      expect(await cliente().findByCode('SCHFPMG001')).toMatchObject({ kind: 'RESULTS' });
    });

    it('timeout: aborta la solicitud, reintenta y devuelve TIMEOUT', async () => {
      const fetchMock = usar(vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))));
      expect(await cliente({}, { timeoutMs: 15 }).findByCode('SCHFPMG001')).toEqual({ kind: 'TIMEOUT' });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('error de red: NETWORK_ERROR sin exponer el error subyacente', async () => {
      usar(vi.fn().mockRejectedValue(new Error(`getaddrinfo ENOTFOUND ${BASE} ${API_KEY}`)));
      const r = await cliente().findByCode('SCHFPMG001');
      expect(r).toEqual({ kind: 'NETWORK_ERROR' });
      expect(JSON.stringify(r)).not.toContain(API_KEY);
    });

    it('JSON inválido y formas inesperadas: INVALID_RESPONSE sin reintentos', async () => {
      const malo = { status: 200, ok: true, headers: new Headers(), json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')) };
      const fetchMock = usar(vi.fn().mockResolvedValue(malo));
      expect(await cliente().findByCode('SCHFPMG001')).toEqual({ kind: 'INVALID_RESPONSE' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      for (const body of [null, 'texto', 42, { value: 'no es arreglo' }, pagina([null]), pagina([{ ID: GUID, Code: 'SCHFPMG001' }]), pagina([producto({ Weight: { x: 1 } })]), pagina([producto()], { nextLink: 42 })]) {
        usar(vi.fn().mockResolvedValue(ok(body)));
        expect(await cliente().findByCode('SCHFPMG001')).toEqual({ kind: 'INVALID_RESPONSE' });
      }
    });
  });

  describe('paginación (nextLink)', () => {
    it('sigue nextLink dentro del host de BIND con un máximo de páginas', async () => {
      const fetchMock = usar(vi.fn()
        .mockResolvedValueOnce(ok(pagina([], { nextLink: `${BASE}/api/Products?$filter=Code%20eq%20'SCHFPMG001'&$skip=1` })))
        .mockResolvedValueOnce(ok(pagina([producto()]))));
      expect(await cliente().findByCode('SCHFPMG001')).toMatchObject({ kind: 'RESULTS', products: [{ Code: 'SCHFPMG001' }] });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1]![0]).toContain('$skip=1');
    });

    it('limita el número de páginas', async () => {
      const fetchMock = usar(vi.fn().mockImplementation(async () => ok(pagina([], { nextLink: `${BASE}/api/Products?$skip=${Math.random()}` }))));
      expect(await cliente({}, { maxPages: 2 }).findByCode('SCHFPMG001')).toEqual({ kind: 'RESULTS', products: [] });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['otro host', 'https://evil.example.com/api/Products?$skip=1'],
      ['HTTP sin TLS', 'http://api.bind.com.mx/api/Products?$skip=1'],
      ['otra ruta', `${BASE}/api/Customers?$skip=1`],
      ['credenciales embebidas', 'https://user:pass@api.bind.com.mx/api/Products?$skip=1'],
      ['puerto distinto', 'https://api.bind.com.mx:8443/api/Products?$skip=1'],
      ['subdominio engañoso', 'https://api.bind.com.mx.evil.example/api/Products?$skip=1']
    ])('rechaza un nextLink con %s y nunca lo sigue', async (_nombre, nextLink) => {
      const fetchMock = usar(vi.fn().mockResolvedValue(ok(pagina([], { nextLink }))));
      expect(await cliente().findByCode('SCHFPMG001')).toEqual({ kind: 'INVALID_RESPONSE' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('el resultado nunca contiene las credenciales', async () => {
    usar(vi.fn().mockResolvedValue(ok(pagina([producto()]))));
    const salida = JSON.stringify(await cliente().findByCode('SCHFPMG001'));
    expect(salida).not.toContain(API_KEY);
    expect(salida).not.toContain(SUB_KEY);
  });
});
