import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SafeExceptionFilter } from '../src/common/http-exception.filter';
import { IS_PUBLIC_KEY } from '../src/security/route-access.decorators';

const { pgPool, interpretar } = vi.hoisted(() => ({ pgPool: vi.fn(), interpretar: vi.fn() }));
// Cualquier uso de PostgreSQL fallaría la prueba: este módulo no debe construir un Pool ni tocar la base.
vi.mock('pg', () => ({ Pool: pgPool, default: { Pool: pgPool } }));
// El interpretador real se conserva; solo se espía para comprobar que el servicio lo invoca (no se duplica su lógica).
vi.mock('../src/manufacturing-sheets/bind-product-interpreter', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/manufacturing-sheets/bind-product-interpreter')>();
  interpretar.mockImplementation(real.interpretarProductoBind);
  return { ...real, interpretarProductoBind: interpretar };
});

import { BindErpClient } from '../src/manufacturing-sheets/bind/bind-erp.client';
import { BindProductsController } from '../src/manufacturing-sheets/bind/bind-products.controller';
import { BindProductsService } from '../src/manufacturing-sheets/bind/bind-products.service';

const GUID = 'bbe2cc0c-3498-47cb-a556-d435eba5c0b4';
const SCHF = { ID: GUID, Code: 'SCHFPMG001', Title: 'BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS', Description: null, Weight: 0.0428, CreationDate: '2025-03-10T15:20:00Z' };

function servicio(resultado: unknown) {
  const client = { findByCode: vi.fn().mockResolvedValue(resultado), findById: vi.fn().mockResolvedValue(resultado) };
  return { service: new BindProductsService(client as never), client };
}
const resultados = (...products: unknown[]) => ({ kind: 'RESULTS', products });

describe('BindProductsService', () => {
  beforeEach(() => { pgPool.mockClear(); interpretar.mockClear(); });

  it('producto encontrado por código: invoca el interpretador existente y devuelve el contrato completo', async () => {
    const { service, client } = servicio(resultados(SCHF));
    const { data } = await service.lookupByCode('  SCHFPMG001 ');
    expect(client.findByCode).toHaveBeenCalledWith('SCHFPMG001');
    expect(interpretar).toHaveBeenCalledTimes(1);
    expect(interpretar).toHaveBeenCalledWith(SCHF);
    expect(data.origen).toBe('BIND');
    expect(data.producto).toEqual(SCHF);
    expect(Object.keys(data.producto).sort()).toEqual(['CreationDate', 'Code', 'Description', 'ID', 'Title', 'Weight'].sort());
    expect(data.interpretacion.campos.pesoLb).toMatchObject({ valor: 0.0428, origen: 'EXTRAIDO' });
    expect(data.interpretacion.campos.resina.valor).toBe('PMG');
    expect(data.familiaSugerida).toEqual(['BOLSA_PLANA_1']);
    expect(data.interpretacion.familia).toEqual({ valor: null, estado: 'PENDIENTE_CONFIRMACION', posiblesEstaFase: ['BOLSA_PLANA_1'] });
    expect(data.pendientes).toEqual([]);
    expect(data.advertencias.map((a) => a.codigo)).toContain('FAMILIA_NO_CONFIRMADA');
    expect(data.datosSugeridosPlantilla).toMatchObject({ codigo: 'SCHFPMG001', peso_bolsa_lb: '0.0428', cantidad: '200 Bolsas' });
    expect(data.especificacionConfirmada).toBe(false);
    // Fase 3.1: sugerencias provisionales con su regla de origen; la familia sigue sin confirmarse.
    expect(data.sugerencias.familia).toMatchObject({ valor: 'BOLSA_PLANA_1' });
    expect(data.sugerencias.resinaVci).toMatchObject({ valor: 'PMG AL 3%', regla: 'RESINA_VCI_PMG_3PCT' });
    expect(data.sugerencias.color).toMatchObject({ preset: 'DAUBERT_AZUL', concentracionPct: '2' });
    expect(data.sugerencias.etiqueta.valor).toBe(SCHF.Title);
    expect(data.interpretacion.campos.calibre.valor).toMatchObject({ valorOriginal: '3', unidadOriginal: 'MIL', textoLiteral: '3 MIL' });
  });

  it('un producto con tres medidas se sugiere como Bolsa Fuelle (provisional) y lo explica', async () => {
    const { service } = servicio(resultados({ ...SCHF, Title: 'BOLSA VCI PMG 51 X 46 X 80" CAL. 200 ROLLO C/50 BOLSAS' }));
    const { data } = await service.lookupByCode('SCHFPMG001');
    expect(data.familiaSugerida).toEqual(['BOLSA_FUELLE']);
    expect(data.sugerencias.familia.valor).toBe('BOLSA_FUELLE');
    expect(data.sugerencias.familia.motivo).toMatch(/tres medidas/i);
    expect(data.interpretacion.campos.fuelleTotal.valor).toBe(46);
  });

  it('producto encontrado por ID', async () => {
    const { service, client } = servicio(resultados(SCHF));
    const { data } = await service.lookupById(GUID.toUpperCase());
    expect(client.findById).toHaveBeenCalledWith(GUID.toUpperCase());
    expect(data.producto.ID).toBe(GUID);
    expect(interpretar).toHaveBeenCalledTimes(1);
  });

  it('Weight = 0: queda pendiente con advertencia y no se sugiere peso', async () => {
    const { service } = servicio(resultados({ ...SCHF, Weight: 0 }));
    const { data } = await service.lookupByCode('SCHFPMG001');
    expect(data.pendientes).toContain('pesoLb');
    expect(data.advertencias.map((a) => a.codigo)).toContain('PESO_CERO');
    expect(data.datosSugeridosPlantilla).not.toHaveProperty('peso_bolsa_lb');
    expect(data.producto.Weight).toBe(0);
  });

  it('producto no encontrado: 404 sin interpretar', async () => {
    const { service } = servicio(resultados());
    await expect(service.lookupByCode('NOEXISTE001')).rejects.toMatchObject({ status: 404, response: { code: 'BIND_PRODUCT_NOT_FOUND' } });
    expect(interpretar).not.toHaveBeenCalled();
  });

  it('múltiples resultados: 409 sin elegir ninguno y sin interpretar ni revelar datos de los productos', async () => {
    const { service } = servicio(resultados(SCHF, { ...SCHF, ID: '11111111-2222-3333-4444-555555555555', Title: 'OTRO' }));
    const error = await service.lookupByCode('SCHFPMG001').catch((e) => e);
    expect(error).toMatchObject({ status: 409, response: { code: 'BIND_MULTIPLE_MATCHES' } });
    expect(JSON.stringify(error.response)).not.toContain('OTRO');
    expect(interpretar).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: 'NOT_CONFIGURED' }, 503, 'BIND_NOT_CONFIGURED'],
    [{ kind: 'UNAUTHORIZED' }, 502, 'BIND_AUTH_FAILED'],
    [{ kind: 'FORBIDDEN' }, 502, 'BIND_AUTH_FAILED'],
    [{ kind: 'RATE_LIMITED', retryAfterSeconds: 30 }, 503, 'BIND_RATE_LIMITED'],
    [{ kind: 'UPSTREAM_ERROR' }, 502, 'BIND_UNAVAILABLE'],
    [{ kind: 'NETWORK_ERROR' }, 502, 'BIND_UNAVAILABLE'],
    [{ kind: 'TIMEOUT' }, 504, 'BIND_TIMEOUT'],
    [{ kind: 'INVALID_RESPONSE' }, 502, 'BIND_INVALID_RESPONSE'],
    [{ kind: 'BAD_REQUEST' }, 502, 'BIND_REQUEST_REJECTED']
  ])('error de BIND %j → HTTP %i %s, con mensaje propio del Hub', async (resultado, status, code) => {
    const { service } = servicio(resultado);
    const error = await service.lookupByCode('SCHFPMG001').catch((e) => e);
    expect(error).toMatchObject({ status, response: { code } });
    expect(JSON.stringify(error.response)).not.toMatch(/Bearer|api\.bind|detalle/i);
  });

  it('valida los parámetros antes de llamar a BIND', async () => {
    const { service, client } = servicio(resultados(SCHF));
    await expect(service.lookupByCode("X' or 1 eq 1")).rejects.toMatchObject({ status: 400, response: { code: 'BIND_INVALID_CODE' } });
    await expect(service.lookupById('no-es-guid')).rejects.toMatchObject({ status: 400, response: { code: 'BIND_INVALID_ID' } });
    expect(client.findByCode).not.toHaveBeenCalled();
    expect(client.findById).not.toHaveBeenCalled();
  });

  it('no realiza escrituras ni conexiones a PostgreSQL', async () => {
    const { service } = servicio(resultados(SCHF));
    await service.lookupByCode('SCHFPMG001');
    await service.lookupById(GUID);
    expect(pgPool).not.toHaveBeenCalled();
    for (const archivo of ['bind/bind-erp.client.ts', 'bind/bind-products.service.ts', 'bind/bind-products.controller.ts', 'manufacturing-sheets.module.ts']) {
      const fuente = readFileSync(resolve(__dirname, '../src/manufacturing-sheets', archivo), 'utf8');
      expect(fuente, archivo).not.toMatch(/from 'pg'|database\.service|DatabaseModule|DatabaseService|INSERT\s|UPDATE\s|DELETE\s/);
    }
  });
});

describe('BindProductsController (HTTP)', () => {
  let app: INestApplication;
  // vitest (esbuild) no emite metadatos de decoradores: se declaran a mano los tipos del constructor para que Nest resuelva la inyección, igual que en producción.
  Reflect.defineMetadata('design:paramtypes', [BindProductsService], BindProductsController);
  Reflect.defineMetadata('design:paramtypes', [BindErpClient], BindProductsService);
  const client = { findByCode: vi.fn(), findById: vi.fn() };

  beforeEach(async () => {
    client.findByCode.mockReset();
    client.findById.mockReset();
    const modulo = await Test.createTestingModule({ controllers: [BindProductsController], providers: [BindProductsService, { provide: BindErpClient, useValue: client }] }).compile();
    app = modulo.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new SafeExceptionFilter());
    await app.init();
  });

  it('GET /api/manufacturing-sheets/bind-products/by-code/:code devuelve el contrato', async () => {
    client.findByCode.mockResolvedValue(resultados(SCHF));
    const res = await request(app.getHttpServer()).get('/api/manufacturing-sheets/bind-products/by-code/SCHFPMG001');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ origen: 'BIND', especificacionConfirmada: false, familiaSugerida: ['BOLSA_PLANA_1'], producto: { Code: 'SCHFPMG001' } });
    expect(res.body.data.interpretacion.familia.valor).toBeNull();
  });

  it('GET /api/manufacturing-sheets/bind-products/by-id/:id', async () => {
    client.findById.mockResolvedValue(resultados(SCHF));
    const res = await request(app.getHttpServer()).get(`/api/manufacturing-sheets/bind-products/by-id/${GUID}`);
    expect(res.status).toBe(200);
    expect(client.findById).toHaveBeenCalledWith(GUID);
  });

  it.each([
    [{ kind: 'RESULTS', products: [] }, 404, 'BIND_PRODUCT_NOT_FOUND'],
    [{ kind: 'UNAUTHORIZED' }, 502, 'BIND_AUTH_FAILED'],
    [{ kind: 'RATE_LIMITED', retryAfterSeconds: 5 }, 503, 'BIND_RATE_LIMITED'],
    [{ kind: 'TIMEOUT' }, 504, 'BIND_TIMEOUT']
  ])('traduce %j a HTTP %i con un cuerpo seguro', async (resultado, status, code) => {
    client.findByCode.mockResolvedValue(resultado);
    const res = await request(app.getHttpServer()).get('/api/manufacturing-sheets/bind-products/by-code/SCHFPMG001');
    expect(res.status).toBe(status);
    // El filtro global SafeExceptionFilter oculta el mensaje y el código de las respuestas 5xx (convención del Hub); los 4xx conservan su código de dominio.
    if (status < 500) expect(res.body.code).toBe(code);
    else expect(res.body).toEqual({ statusCode: status, message: 'Error interno del servidor.' });
    expect(JSON.stringify(res.body)).not.toMatch(/Bearer|apikey|api\.bind/i);
  });

  it('rechaza parámetros inválidos con 400 sin llamar a BIND', async () => {
    const res = await request(app.getHttpServer()).get("/api/manufacturing-sheets/bind-products/by-code/X'%20or%20'1'='1");
    expect(res.status).toBe(400);
    expect(client.findByCode).not.toHaveBeenCalled();
  });

  it('las rutas son autenticadas (no @Public) y siguen la convención /api/manufacturing-sheets/…', () => {
    expect(Reflect.getMetadata(PATH_METADATA, BindProductsController)).toBe('manufacturing-sheets/bind-products');
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, BindProductsController)).toBeUndefined();
    for (const metodo of ['byCode', 'byId'] as const) expect(Reflect.getMetadata(IS_PUBLIC_KEY, BindProductsController.prototype[metodo])).toBeUndefined();
  });
});
