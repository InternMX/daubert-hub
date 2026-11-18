import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SafeExceptionFilter } from '../src/common/http-exception.filter';
import { BindErpClient } from '../src/manufacturing-sheets/bind/bind-erp.client';
import { BindProductsController } from '../src/manufacturing-sheets/bind/bind-products.controller';
import { BindProductsService, RECENT_CACHE_MAX_ENTRIES, RECENT_CACHE_TTL_MS, RECENT_MIN_REFRESH_MS } from '../src/manufacturing-sheets/bind/bind-products.service';
import { clasificarNovedad, fechaDeAlta } from '../src/manufacturing-sheets/bind/recent-products';
import { ConfigService } from '@nestjs/config';
import { ManufacturingSheetsEnabledGuard } from '../src/manufacturing-documents/manufacturing-enabled.guard';
// El guard de habilitación de Manufactura se inyecta con ConfigService (esbuild no emite metadata de decoradores).
Reflect.defineMetadata('design:paramtypes', [ConfigService], ManufacturingSheetsEnabledGuard);
const CONFIG_MANUFACTURA = { provide: ConfigService, useValue: { get: () => ({ enabled: true, emission: 'PRUEBA' }) } };

const API_KEY = 'clave-api-de-prueba-0000';
const SUB_KEY = 'clave-suscripcion-de-prueba-1111';
const BASE = 'https://api.bind.com.mx';
const GUID = 'bbe2cc0c-3498-47cb-a556-d435eba5c0b4';
const raw = (over: Record<string, unknown> = {}) => ({ ID: GUID, Code: 'SCHFPMG001', Title: 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS', Description: null, Weight: 0.0428, CreationDate: '2026-10-13T10:00:00.5', Cost: 99, ...over });
const ok = (body: unknown) => ({ status: 200, ok: true, json: vi.fn().mockResolvedValue(body), headers: new Headers() });
const http = (status: number) => ({ status, ok: false, json: vi.fn().mockResolvedValue({ message: 'detalle interno', apiKey: API_KEY }), headers: new Headers() });
const cliente = (config: Partial<{ apiKey: string | null }> = {}) => new BindErpClient({ get: vi.fn().mockReturnValue({ baseUrl: BASE, apiKey: API_KEY, subscriptionKey: SUB_KEY, ...config }) } as never, { timeoutMs: 40, totalTimeoutMs: 2_000, retryDelaysMs: [0, 0], maxRetryAfterMs: 10, maxPages: 3 });

describe('BindErpClient.listRecent (consulta de novedades)', () => {
  const originalFetch = global.fetch;
  const usar = (fn: ReturnType<typeof vi.fn>) => { global.fetch = fn as never; return fn; };
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  it('consulta UNA página ordenada por fecha de alta descendente con $top y $skip, solo GET por HTTPS, sin credenciales en la URL', async () => {
    const fetchMock = usar(vi.fn().mockResolvedValue(ok({ value: [raw({ Code: 'A', CreationDate: '2026-10-22T16:07:00.883' }), raw({ Code: 'B', CreationDate: '2026-10-20T10:00:00' })], nextLink: `${BASE}/api/Products?$skip=100` })));
    const r = await cliente().listRecent(20, 30);
    expect(r).toMatchObject({ kind: 'RECENT', products: [{ Code: 'A' }, { Code: 'B' }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);                                        // no sigue nextLink: nunca recorre el catálogo
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/api/Products?$orderby=CreationDate%20desc&$top=30&$skip=20`);
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('error');
    expect(init.headers).toEqual({ Accept: 'application/json', Authorization: `Bearer ${API_KEY}`, 'Ocp-Apim-Subscription-Key': SUB_KEY });
    expect(String(url)).not.toContain(API_KEY);
    expect(JSON.stringify(r)).not.toContain('Cost');                                  // solo los seis campos permitidos
  });

  it('rechaza límites fuera de rango sin consultar a BIND', async () => {
    const fetchMock = usar(vi.fn());
    for (const [skip, top] of [[-1, 10], [0, 0], [0, 101], [501, 10], [1.5, 10], [0, Number.NaN]]) expect(await cliente().listRecent(skip!, top!)).toEqual({ kind: 'BAD_REQUEST' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sin credenciales configuradas informa NOT_CONFIGURED sin llamar a BIND', async () => {
    const fetchMock = usar(vi.fn());
    expect(await cliente({ apiKey: null }).listRecent(0, 10)).toEqual({ kind: 'NOT_CONFIGURED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('si BIND no devuelve la página ordenada por fecha de alta (orden no comprobable) es una respuesta inválida: no se presentan «recientes» sin poder comprobarlo', async () => {
    usar(vi.fn().mockResolvedValue(ok({ value: [raw({ Code: 'A', CreationDate: '2020-01-01T00:00:00' }), raw({ Code: 'B', CreationDate: '2026-01-01T00:00:00' })] })));
    expect(await cliente().listRecent(0, 10)).toEqual({ kind: 'INVALID_RESPONSE' });
    usar(vi.fn().mockResolvedValue(ok({ value: [raw({ CreationDate: 'no-es-fecha' })] })));
    expect(await cliente().listRecent(0, 10)).toEqual({ kind: 'INVALID_RESPONSE' });
    usar(vi.fn().mockResolvedValue(ok({ value: [raw(), raw({ Code: 'B' }), raw({ Code: 'C' })] })));
    expect(await cliente().listRecent(0, 2)).toEqual({ kind: 'INVALID_RESPONSE' });      // más productos de los pedidos
  });

  it('los errores de BIND se traducen sin exponer cuerpos ni credenciales', async () => {
    usar(vi.fn().mockResolvedValue(http(401)));
    expect(await cliente().listRecent(0, 10)).toEqual({ kind: 'UNAUTHORIZED' });
    usar(vi.fn().mockResolvedValue(http(500)));
    const r = await cliente().listRecent(0, 10);
    expect(r).toEqual({ kind: 'UPSTREAM_ERROR' });
    expect(JSON.stringify(r)).not.toContain(API_KEY);
  });
});

describe('clasificarNovedad (clasificación conservadora)', () => {
  it('familia sugerida y Title/Code coherentes → COMPATIBLE, con fecha de alta', () => {
    expect(clasificarNovedad(raw())).toMatchObject({ code: 'SCHFPMG001', familiaSugerida: 'BOLSA_PLANA_1', compatibilidad: 'COMPATIBLE', fechaAlta: '2026-10-13' });
  });
  it('Title y Code contradictorios → POR_CONFIRMAR (la familia se sugiere pero se advierte)', () => {
    expect(clasificarNovedad(raw({ Code: 'ITESFCP002' }))).toMatchObject({ familiaSugerida: 'BOLSA_PLANA_1', compatibilidad: 'POR_CONFIRMAR' });
  });
  it('papel y tubo → SIN_PLANTILLA; no se inventa una familia plástica', () => {
    expect(clasificarNovedad(raw({ Code: 'TARPPW3301', Title: 'PAPEL VCI PW33 100 X 200 MM PAQUETE C/100 HOJAS' }))).toMatchObject({ familiaSugerida: null, compatibilidad: 'SIN_PLANTILLA' });
    expect(clasificarNovedad(raw({ Code: 'TUBO001', Title: 'TUBO VCI PMG 10 X 20 CAL. 3 MIL' }))).toMatchObject({ familiaSugerida: null, compatibilidad: 'SIN_PLANTILLA' });
  });
  it('un título que no permite identificar nada → SIN_FAMILIA (no se inventa compatibilidad)', () => {
    expect(clasificarNovedad(raw({ Code: 'XYZ', Title: 'SERVICIO DE ASESORIA' }))).toMatchObject({ familiaSugerida: null, compatibilidad: 'SIN_FAMILIA' });
  });
  it('la fecha solo se muestra si es confiable: formato ISO válido y no futura', () => {
    const ahora = Date.parse('2026-10-29T12:00:00');
    expect(fechaDeAlta('2026-10-22T16:07:00.883', ahora)).toBe('2026-10-22');
    expect(fechaDeAlta(null, ahora)).toBeNull();
    expect(fechaDeAlta('2026-13-45T00:00:00', ahora)).toBeNull();
    expect(fechaDeAlta('29/10/2026', ahora)).toBeNull();
    expect(fechaDeAlta('2027-05-01T00:00:00', ahora)).toBeNull();
  });
});

describe('BindProductsService.listRecent', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-29T12:00:00')); });
  afterEach(() => { vi.useRealTimers(); });
  const pagina = (n: number, prefijo = 'P') => Array.from({ length: n }, (_, i) => raw({ ID: `id-${prefijo}${i}`, Code: `${prefijo}${i}`, CreationDate: `2026-10-${String(28 - i).padStart(2, '0')}T10:00:00` }));
  const servicio = (resultado: unknown = { kind: 'RECENT', products: pagina(3) }) => {
    const client = { listRecent: vi.fn().mockResolvedValue(resultado) };
    return { service: new BindProductsService(client as never), client };
  };

  it('devuelve las novedades clasificadas y la paginación (nextSkip solo si BIND llenó la página)', async () => {
    const { service, client } = servicio({ kind: 'RECENT', products: pagina(3) });
    const llena = await service.listRecent('0', '3');
    expect(client.listRecent).toHaveBeenCalledWith(0, 3);
    expect(llena.data).toMatchObject({ skip: 0, limit: 3, nextSkip: 3, orden: 'CreationDate desc', desdeCache: false });
    expect(llena.data.items.map((i) => i.code)).toEqual(['P0', 'P1', 'P2']);
    const parcial = await servicio({ kind: 'RECENT', products: pagina(2) }).service.listRecent('0', '3');
    expect(parcial.data.nextSkip).toBeNull();                                         // BIND devolvió menos: no hay más
    expect((await servicio({ kind: 'RECENT', products: pagina(30) }).service.listRecent('480', '30')).data.nextSkip).toBeNull();   // límite de exploración (500)
    expect((await servicio({ kind: 'RECENT', products: pagina(30) }).service.listRecent('470', '30')).data.nextSkip).toBe(500);
  });

  it('no expone el ID de BIND, costos ni credenciales en la respuesta', async () => {
    const { service } = servicio();
    const texto = JSON.stringify(await service.listRecent(undefined, undefined));
    expect(texto).not.toContain('id-P0');
    expect(texto).not.toContain('Cost');
    expect(texto).not.toContain(API_KEY);
    expect(Object.keys((await service.listRecent(undefined, undefined)).data.items[0]!).sort()).toEqual(['code', 'compatibilidad', 'familiaSugerida', 'fechaAlta', 'motivo', 'title']);
  });

  it('caché temporal: la misma página no vuelve a consultar BIND hasta que vence', async () => {
    const { service, client } = servicio();
    await service.listRecent('0', '3');
    const segunda = await service.listRecent('0', '3');
    expect(client.listRecent).toHaveBeenCalledTimes(1);
    expect(segunda.data.desdeCache).toBe(true);
    await service.listRecent('3', '3');                                               // otra página: otra entrada
    expect(client.listRecent).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(RECENT_CACHE_TTL_MS + 1);
    expect((await service.listRecent('0', '3')).data.desdeCache).toBe(false);
    expect(client.listRecent).toHaveBeenCalledTimes(3);
  });

  it('actualización manual: consulta de nuevo a BIND, pero no antes del intervalo mínimo', async () => {
    const { service, client } = servicio();
    await service.listRecent('0', '3');
    expect((await service.listRecent('0', '3', true)).data.desdeCache).toBe(true);    // demasiado pronto: se sirve la caché
    expect(client.listRecent).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(RECENT_MIN_REFRESH_MS + 1);
    expect((await service.listRecent('0', '3', true)).data.desdeCache).toBe(false);
    expect(client.listRecent).toHaveBeenCalledTimes(2);
  });

  it('solicitudes simultáneas iguales comparten una sola consulta a BIND', async () => {
    const { service, client } = servicio();
    await Promise.all([service.listRecent('0', '3'), service.listRecent('0', '3'), service.listRecent('0', '3')]);
    expect(client.listRecent).toHaveBeenCalledTimes(1);
  });

  it('la caché está acotada y un error de BIND no se guarda', async () => {
    const { service, client } = servicio();
    for (let i = 0; i < RECENT_CACHE_MAX_ENTRIES + 3; i += 1) await service.listRecent(String(i), '3');
    expect((service as unknown as { recentCache: Map<string, unknown> }).recentCache.size).toBe(RECENT_CACHE_MAX_ENTRIES);
    client.listRecent.mockResolvedValueOnce({ kind: 'UPSTREAM_ERROR' });
    await expect(service.listRecent('200', '3')).rejects.toMatchObject({ response: { code: 'BIND_UNAVAILABLE' } });
    await service.listRecent('200', '3');                                             // el error no quedó en la caché
    expect(client.listRecent).toHaveBeenCalledTimes(RECENT_CACHE_MAX_ENTRIES + 3 + 2);
  });

  it.each([['NOT_CONFIGURED', 'BIND_NOT_CONFIGURED'], ['UNAUTHORIZED', 'BIND_AUTH_FAILED'], ['RATE_LIMITED', 'BIND_RATE_LIMITED'], ['TIMEOUT', 'BIND_TIMEOUT'], ['INVALID_RESPONSE', 'BIND_INVALID_RESPONSE'], ['NETWORK_ERROR', 'BIND_UNAVAILABLE']])('error de BIND %s → %s sin datos internos', async (kind, code) => {
    const { service } = servicio({ kind, retryAfterSeconds: 5 });
    await expect(service.listRecent('0', '3')).rejects.toMatchObject({ response: { code } });
    await service.listRecent('0', '3').catch((e: { response: unknown }) => expect(JSON.stringify(e.response)).not.toContain(API_KEY));
  });

  it.each([['-1', '10'], ['abc', '10'], ['0', '0'], ['0', '51'], ['501', '10'], ['1.5', '10']])('parámetros inválidos (skip=%s, limit=%s) → 400 sin consultar a BIND', async (skip, limit) => {
    const { service, client } = servicio();
    await expect(service.listRecent(skip, limit)).rejects.toMatchObject({ response: { code: 'BIND_INVALID_PAGE' } });
    expect(client.listRecent).not.toHaveBeenCalled();
  });
});

describe('GET /api/manufacturing-sheets/bind-products/recent', () => {
  let app: INestApplication;
  // vitest (esbuild) no emite metadatos de decoradores: se declaran los tipos del constructor para la inyección (igual que bind-products.service.spec.ts).
  Reflect.defineMetadata('design:paramtypes', [BindProductsService], BindProductsController);
  Reflect.defineMetadata('design:paramtypes', [BindErpClient], BindProductsService);
  const client = { listRecent: vi.fn(), findByCode: vi.fn(), findById: vi.fn() };
  beforeEach(async () => {
    client.listRecent.mockReset().mockResolvedValue({ kind: 'RECENT', products: [raw()] });
    const modulo = await Test.createTestingModule({ controllers: [BindProductsController], providers: [CONFIG_MANUFACTURA, BindProductsService, { provide: BindErpClient, useValue: client }] }).compile();
    app = modulo.createNestApplication(); app.setGlobalPrefix('api'); app.useGlobalFilters(new SafeExceptionFilter()); await app.init();
  });
  afterEach(async () => { await app.close(); });

  it('entrega las novedades y respeta skip, limit y refresh', async () => {
    const r = await request(app.getHttpServer()).get('/api/manufacturing-sheets/bind-products/recent?skip=0&limit=10');
    expect(r.status).toBe(200);
    expect(r.body.data.items[0]).toMatchObject({ code: 'SCHFPMG001', compatibilidad: 'COMPATIBLE' });
    expect(client.listRecent).toHaveBeenCalledWith(0, 10);
  });
  it('un parámetro inválido es 400 y un fallo de BIND es 502 sin exponer detalles', async () => {
    expect((await request(app.getHttpServer()).get('/api/manufacturing-sheets/bind-products/recent?limit=999')).status).toBe(400);
    client.listRecent.mockResolvedValue({ kind: 'UPSTREAM_ERROR' });
    const r = await request(app.getHttpServer()).get('/api/manufacturing-sheets/bind-products/recent?skip=40&limit=10');
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toContain(API_KEY);
  });
});
