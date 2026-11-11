import 'reflect-metadata';
import { CanActivate, ExecutionContext, INestApplication, Injectable } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SafeExceptionFilter } from '../../src/common/http-exception.filter';
import { createGlobalValidationPipe } from '../../src/config/validation-pipe';
import type { DatabaseService } from '../../src/database/database.service';
import { ListRecentActivityDto } from '../../src/recent-activity/dto/list-recent-activity.dto';
import { ManufacturingActivityRepository } from '../../src/recent-activity/manufacturing-activity.repository';
import { RecentActivityController } from '../../src/recent-activity/recent-activity.controller';
import { RecentActivityService } from '../../src/recent-activity/recent-activity.service';
import { emitirTiposDeParametros } from '../support/design-metadata';
import { actor, codigoUnico, crearServicio, entradaBorrador, poolApp, type Vista } from './entorno';

// «Actividad reciente» por HTTP REAL, de extremo a extremo para la parte que esta rama modificó (controlador → servicio → ManufacturingActivityRepository → RLS de la base desechable con 101–105):
// la identidad sale SOLO de la sesión, la consulta compartida (105) decide qué se ve, los eventos se mezclan con las demás fuentes, y los filtros/límites del DTO se respetan.
// El runner `recent-activity.integration.runner.cjs` se detiene antes de llegar a este código (paso previo de ajuste de folios): esta prueba cubre ese hueco.
// Las otras fuentes (auditoría, Pagos, Audi, Caterpillar, series) son sustitutos controlados: esta rama no las modificó y no se prueba aquí su SQL.
emitirTiposDeParametros(RecentActivityController, { list: [ListRecentActivityDto, Object] });

const CUENTAS: Record<string, { id: string; email: string; displayName: string; role: 'ADMIN' | 'GENERAL' }> = {
  '1': { id: '1', email: 'admin1@example.invalid', displayName: 'Admin Uno', role: 'ADMIN' },
  '2': { id: '2', email: 'g2@example.invalid', displayName: 'General Dos', role: 'GENERAL' },
  '3': { id: '3', email: 'g3@example.invalid', displayName: 'General Tres', role: 'GENERAL' }
};
// Sesión de prueba: `x-test-user` elige la cuenta; `anonima` deja request.user vacío (el guard real rechazaría; aquí se comprueba que el controlador no inventa identidad).
@Injectable()
class SesionDePrueba implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const cuenta = CUENTAS[String(req.headers['x-test-user'] ?? '')];
    if (cuenta) req.user = { ...cuenta, status: 'ACTIVE', mustChangePassword: false };
    return true;
  }
}

const PAGO_ANTIGUO = '2020-01-01T00:00:00.000Z';
const fuenteAuditoria = { findRecent: vi.fn().mockResolvedValue({ rows: [], contacts: new Map(), companies: new Map(), companyRoles: new Map(), actorDisplayNames: new Map() }) };
const fuentePagos = { findRecent: vi.fn().mockResolvedValue([{ execution_state: 'PROCESADO', occurred_at: PAGO_ANTIGUO, result_count: 1, ready_count: 1, manual_count: 0, error_count: 0, omitted_count: 0 }]) };
const vacia = { findRecent: vi.fn().mockResolvedValue([]) };
const series = { findRecent: vi.fn().mockResolvedValue([]), findActorDisplayNames: vi.fn().mockResolvedValue(new Map()) };
const bd = { connect: () => poolApp.connect() } as unknown as DatabaseService;
const manufactura = new ManufacturingActivityRepository(bd);
const espia = vi.spyOn(manufactura, 'findRecent');
class ControladorReal extends RecentActivityController {
  constructor() { super(new RecentActivityService(fuenteAuditoria as never, fuentePagos as never, vacia as never, vacia as never, series as never, manufactura)); }
}

let app: INestApplication;
const { service } = crearServicio();
const get = (cuenta: string, consulta = '') => request(app.getHttpServer()).get(`/recent-activity${consulta}`).set('x-test-user', cuenta);
type Item = { type: string; category: string; entity: string; context: string | null; occurredAt: string; actor: { id: string; displayName: string | null } | null; link?: string };
const eventos = async (cuenta: string, codigo: string): Promise<Item[]> => {
  const r = await get(cuenta, '?limit=20');
  expect(r.status).toBe(200);
  return (r.body.data as Item[]).filter((i) => i.entity === codigo);
};
const crear = (n: 1 | 2 | 3, codigo: string): Promise<Vista> => service.crearBorrador(actor(n), entradaBorrador(codigo, { cliente: { nombre: 'Cliente de prueba' } }) as never) as Promise<Vista>;
async function finalizar(n: 1 | 2 | 3, v: Vista): Promise<Vista> {
  const c = await service.actualizarBorrador(actor(n), v.id, { version: v.version, elaboroConfirmado: true } as never) as Vista;
  return service.finalizar(actor(n), c.id, c.version) as Promise<Vista>;
}

beforeAll(async () => {
  const modulo = await Test.createTestingModule({ controllers: [ControladorReal], providers: [{ provide: APP_GUARD, useClass: SesionDePrueba }] }).compile();
  app = modulo.createNestApplication();
  app.useGlobalPipes(createGlobalValidationPipe());
  app.useGlobalFilters(new SafeExceptionFilter());
  await app.init();
});
afterAll(async () => { await app.close(); });

describe('Actividad reciente por HTTP · Hojas de manufactura (base desechable con 101–105)', () => {
  it('el borrador de una cuenta GENERAL aparece para ella, para otra GENERAL (consulta compartida) y para ADMIN, con su autor y el enlace a la hoja; la identidad la pone la sesión', async () => {
    const codigo = codigoUnico('HTTPA');
    const v = await crear(2, codigo);
    espia.mockClear();
    for (const cuenta of ['2', '3', '1']) {
      const lista = await eventos(cuenta, codigo);
      expect(lista).toHaveLength(1);
      expect(lista[0]).toMatchObject({ type: 'MANUFACTURING_DOCUMENT_CREATED', category: 'AUTOMATION', title: 'Hoja de manufactura creada', context: 'Borrador inicial', actor: { id: '2', displayName: 'General Dos' }, link: `/automations/manufacturing-sheets?revision=${v.id}` });
    }
    expect(espia.mock.calls.map((c) => c[1])).toEqual([{ userId: '2', role: 'GENERAL' }, { userId: '3', role: 'GENERAL' }, { userId: '1', role: 'ADMIN' }]);
  });

  it('finalizar y crear una nueva revisión generan sus propios eventos, ordenados del más reciente al más antiguo; el de creación no cambia', async () => {
    const codigo = codigoUnico('HTTPB');
    const fin = await finalizar(2, await crear(2, codigo));
    const nueva = await service.crearRevisionNueva(actor(1), fin.documentoId) as Vista;   // solo autor o ADMIN abren una nueva revisión (prueba 04): ADMIN, para que el autor del evento difiera del documento
    const lista = await eventos('1', codigo);
    expect(lista.map((i) => [i.type, i.context])).toEqual([
      ['MANUFACTURING_REVISION_CREATED', 'Basada en REV01'],
      ['MANUFACTURING_REVISION_FINALIZED', 'REV01 · Finalizada'],
      ['MANUFACTURING_DOCUMENT_CREATED', 'Borrador inicial']
    ]);
    expect(lista[0]).toMatchObject({ actor: { id: '1' }, link: `/automations/manufacturing-sheets?revision=${nueva.id}` });
    expect(lista[1]).toMatchObject({ actor: { id: '2' }, link: `/automations/manufacturing-sheets?revision=${fin.id}` });
    const fechas = lista.map((i) => new Date(i.occurredAt).getTime());
    expect([...fechas].sort((a, b) => b - a)).toEqual(fechas);
    expect(await eventos('3', codigo)).toHaveLength(3);
  });

  it('un borrador DESCARTADO no aparece para nadie, ni para su autor', async () => {
    const codigo = codigoUnico('HTTPC');
    const v = await crear(2, codigo);
    await service.descartarBorrador(actor(2), v.id, v.version);
    for (const cuenta of ['2', '3', '1']) expect(await eventos(cuenta, codigo)).toEqual([]);
  });

  it('sin identidad de sesión no se consulta Manufactura y las demás fuentes siguen respondiendo', async () => {
    await crear(2, codigoUnico('HTTPD'));
    espia.mockClear();
    const r = await get('anonima', '?limit=20');
    expect(r.status).toBe(200);
    expect(espia).not.toHaveBeenCalled();
    expect((r.body.data as Item[]).some((i) => i.type.startsWith('MANUFACTURING_'))).toBe(false);
    expect((r.body.data as Item[]).some((i) => i.occurredAt === PAGO_ANTIGUO)).toBe(true);
  });

  it('la identidad no se puede tomar de la consulta: parámetros desconocidos se rechazan con 400 (validación global) y no se consulta nada', async () => {
    espia.mockClear();
    for (const q of ['?userId=1', '?role=ADMIN', '?actor=1', '?limit=21', '?limit=0', '?category=MANUFACTURA']) {
      const r = await get('3', q);
      expect(r.status, q).toBe(400);
    }
    expect(espia).not.toHaveBeenCalled();
  });

  it('filtros: Clientes no consulta Manufactura; Automatizaciones sí; el límite se aplica a la lista ya mezclada (la fuente antigua queda fuera)', async () => {
    const codigo = codigoUnico('HTTPE');
    await crear(2, codigo);
    espia.mockClear();
    const clientes = await get('2', '?category=CLIENT&limit=20');
    expect(clientes.status).toBe(200);
    expect(espia).not.toHaveBeenCalled();
    expect((clientes.body.data as Item[]).some((i) => i.type.startsWith('MANUFACTURING_'))).toBe(false);
    const auto = await get('2', '?category=AUTOMATION&limit=20');
    expect((auto.body.data as Item[]).some((i) => i.entity === codigo)).toBe(true);
    const dos = await get('2', '?limit=2');
    expect(dos.body.data).toHaveLength(2);
    expect((dos.body.data as Item[]).every((i) => i.occurredAt !== PAGO_ANTIGUO)).toBe(true);
    expect((dos.body.data as Item[])[0]).toMatchObject({ entity: codigo });
  });

  it('un fallo de la base en la parte de Manufactura no rompe la Actividad reciente (se registra y se omite)', async () => {
    const roto = new ManufacturingActivityRepository({ connect: () => Promise.reject(new Error('conexion rechazada (simulada)')) } as unknown as DatabaseService);
    const servicio = new RecentActivityService(fuenteAuditoria as never, fuentePagos as never, vacia as never, vacia as never, series as never, roto);
    const r = await servicio.list({ limit: 6 }, { userId: '2', role: 'GENERAL' });
    expect(r.data.some((i) => i.type.startsWith('MANUFACTURING_'))).toBe(false);
    expect(r.data.some((i) => i.occurredAt === PAGO_ANTIGUO)).toBe(true);
  });
});
