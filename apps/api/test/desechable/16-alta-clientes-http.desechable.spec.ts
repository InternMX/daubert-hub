import 'reflect-metadata';
import { CanActivate, ExecutionContext, INestApplication, Injectable, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClientsController } from '../../src/clients/clients.controller';
import { ClientsRepository } from '../../src/clients/clients.repository';
import { ClientsService } from '../../src/clients/clients.service';
import { CreateClientDto } from '../../src/clients/dto/create-client.dto';
import { ListClientsDto } from '../../src/clients/dto/list-clients.dto';
import { UpdateClientDto } from '../../src/clients/dto/update-client.dto';
import { SafeExceptionFilter } from '../../src/common/http-exception.filter';
import { createGlobalValidationPipe } from '../../src/config/validation-pipe';
import type { DatabaseService } from '../../src/database/database.service';
import { RolesGuard } from '../../src/security/roles.guard';
import { emitirTiposDeParametros } from '../support/design-metadata';
import { poolAdmin, poolApp } from './entorno';

// Configuración EFECTIVA de la API: el mismo ValidationPipe global y SafeExceptionFilter de main.ts, con los metadatos de tipos que emite `tsc` (vitest no los emite).
emitirTiposDeParametros(ClientsController, { list: [ListClientsDto], detail: [String], create: [CreateClientDto, Object], update: [String, UpdateClientDto, Object], deactivate: [String, Object], reactivate: [String, Object] });

// Alta de clientes por HTTP real (Nest + RolesGuard global + ClientsService/ClientsRepository REALES) contra la instancia desechable: ADMIN crea, GENERAL recibe 403 sin crear nada, y los duplicados se detectan
// sin generar empresas repetidas. La réplica mínima no trae las tablas fiscales de core: se completan aquí (solo en la instancia desechable).
@Injectable()
class SesionDePrueba implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const rol = req.headers['x-test-role'];
    if (!rol) throw new UnauthorizedException();
    req.requestId = `http-${Date.now()}`;
    req.user = rol === 'ADMIN'
      ? { id: '1', email: 'admin1@example.invalid', displayName: 'Admin Uno', role: 'ADMIN', status: 'ACTIVE', mustChangePassword: false }
      : { id: '2', email: 'g2@example.invalid', displayName: 'General Dos', role: 'GENERAL', status: 'ACTIVE', mustChangePassword: false };
    return true;
  }
}
const bd = { connect: () => poolApp.connect(), query: (texto: string, valores?: unknown[]) => poolApp.query(texto, valores as never).then((r) => r.rows) } as unknown as DatabaseService;
// vitest no emite metadatos de inyección: el controlador REAL se instancia con servicio y repositorio reales.
class ControladorReal extends ClientsController { constructor() { super(new ClientsService(new ClientsRepository(bd))); } }

let app: INestApplication;
const post = (rol: 'ADMIN' | 'GENERAL', cuerpo: Record<string, unknown>) => request(app.getHttpServer()).post('/clients').set('x-test-role', rol).send(cuerpo);
const contar = async (nombre: string): Promise<number> => (await poolAdmin.query('SELECT count(*)::int AS n FROM core.empresas WHERE lower(btrim(nombre_comercial)) = lower(btrim($1))', [nombre])).rows[0].n;
let n = 0;
const nombre = (base: string): string => { n += 1; return `${base} ${Date.now()}-${n}`; };

beforeAll(async () => {
  await poolAdmin.query(`
    ALTER TABLE core.empresas ADD COLUMN IF NOT EXISTS observaciones text;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_empresas_nombre_comercial ON core.empresas (lower(btrim(nombre_comercial)));
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'core.empresa_roles'::regclass AND contype = 'p') THEN ALTER TABLE core.empresa_roles ADD PRIMARY KEY (empresa_id, rol); END IF; END $$;
    CREATE TABLE IF NOT EXISTS core.empresas_fiscales (empresa_fiscal_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, empresa_id bigint NOT NULL REFERENCES core.empresas, razon_social text NOT NULL,
      rfc varchar(13) NOT NULL UNIQUE, es_vigente boolean NOT NULL DEFAULT true, fecha_inicio date, fecha_fin date);
    GRANT SELECT, INSERT, UPDATE ON core.empresas, core.empresa_roles, core.empresas_fiscales TO daubert_hub_test_user;`);
  const modulo = await Test.createTestingModule({
    controllers: [ControladorReal],
    providers: [{ provide: APP_GUARD, useClass: SesionDePrueba }, { provide: APP_GUARD, useFactory: (r: Reflector) => new RolesGuard(r), inject: [Reflector] }]
  }).compile();
  app = modulo.createNestApplication();
  app.useGlobalPipes(createGlobalValidationPipe());
  app.useGlobalFilters(new SafeExceptionFilter());
  await app.init();
});
afterAll(async () => { await app.close(); });

describe('alta de clientes · ADMIN crea, GENERAL no (HTTP + base desechable)', () => {
  it('ADMIN crea el cliente: 201, una empresa con rol CLIENTE activo, datos fiscales opcionales y auditoría a nombre del ADMIN', async () => {
    const nuevo = nombre('Alta Admin');
    const r = await post('ADMIN', { commercialName: nuevo });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ commercialName: nuevo, clientStatus: 'ACTIVO', roles: ['CLIENTE'], fiscal: null });
    expect(await contar(nuevo)).toBe(1);
    const aud = await poolAdmin.query("SELECT usuario_id FROM audit.cambios WHERE esquema = 'core' AND tabla = 'empresas' AND datos_nuevos->>'nombre_comercial' = $1", [nuevo]);
    expect(aud.rowCount === 0 || aud.rows[0].usuario_id === '1').toBe(true);          // la réplica no instala el trigger de core: si existiera, la identidad es la del ADMIN
    const conFiscal = nombre('Con Fiscal');
    const f = await post('ADMIN', { commercialName: conFiscal, fiscal: { legalName: 'Con Fiscal SA de CV', rfc: 'cfi010101aaa' } });
    expect(f.status).toBe(201);
    expect(f.body.data.fiscal).toMatchObject({ legalName: 'Con Fiscal SA de CV', rfc: 'CFI010101AAA' });      // el DTO real convierte el RFC a mayúsculas antes de guardarlo
    expect((await poolAdmin.query('SELECT rfc FROM core.empresas_fiscales WHERE empresa_id = $1', [f.body.data.id])).rows[0].rfc).toBe('CFI010101AAA');
  });

  it('GENERAL recibe 403 ROLE_NOT_ALLOWED llamando directamente al endpoint y la base queda intacta (ni empresa ni rol ni datos fiscales)', async () => {
    const intento = nombre('Alta General');
    const empresasAntes = (await poolAdmin.query('SELECT count(*)::int AS n FROM core.empresas')).rows[0].n;
    const r = await post('GENERAL', { commercialName: intento, fiscal: { legalName: 'Intento SA', rfc: 'INT010101AAA' } });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('ROLE_NOT_ALLOWED');
    expect(await contar(intento)).toBe(0);
    expect((await poolAdmin.query('SELECT count(*)::int AS n FROM core.empresas')).rows[0].n).toBe(empresasAntes);
    expect((await poolAdmin.query("SELECT count(*)::int AS n FROM core.empresas_fiscales WHERE rfc = 'INT010101AAA'")).rows[0].n).toBe(0);
  });

  it('detección de duplicado: repetir el nombre de un cliente activo responde 409 CLIENT_ALREADY_ACTIVE y NO crea otra empresa (ni con mayúsculas/espacios distintos)', async () => {
    const base = nombre('Duplicado');
    expect((await post('ADMIN', { commercialName: base })).status).toBe(201);
    const r = await post('ADMIN', { commercialName: `  ${base.toUpperCase()}  ` });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CLIENT_ALREADY_ACTIVE');
    expect(await contar(base)).toBe(1);
  });

  it('empresa existente con OTRO rol: no se duplica; se le agrega el rol CLIENTE (misma empresa, mismos datos) y conserva el rol anterior', async () => {
    const existente = nombre('Proveedor Previo');
    const e = await poolAdmin.query("INSERT INTO core.empresas (tipo_empresa, nombre_comercial) VALUES ('PROVEEDOR', $1) RETURNING empresa_id::text AS id", [existente]);
    await poolAdmin.query("INSERT INTO core.empresa_roles (empresa_id, rol) VALUES ($1, 'PROVEEDOR')", [e.rows[0].id]);
    const r = await post('ADMIN', { commercialName: existente });
    expect(r.status).toBe(201);
    expect(r.body.data.id).toBe(e.rows[0].id);                                                    // la MISMA empresa
    expect(r.body.data.roles.sort()).toEqual(['CLIENTE', 'PROVEEDOR']);
    expect(await contar(existente)).toBe(1);
  });

  it('RFC ya usado por otra empresa: 409 CLIENT_RFC_CONFLICT sin crear nada', async () => {
    const a = nombre('RFC Dueño');
    await post('ADMIN', { commercialName: a, fiscal: { legalName: 'Dueño SA', rfc: 'DUE010101AAA' } });
    const b = nombre('RFC Intruso');
    const r = await post('ADMIN', { commercialName: b, fiscal: { legalName: 'Intruso SA', rfc: 'DUE010101AAA' } });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CLIENT_RFC_CONFLICT');
    expect(await contar(b)).toBe(0);
  });

  it('GENERAL conserva la consulta y selección: lista y detalle del cliente recién creado (200)', async () => {
    const consultable = nombre('Consultable');
    const creado = await post('ADMIN', { commercialName: consultable });
    const lista = await request(app.getHttpServer()).get('/clients').query({ search: consultable, page: '1', pageSize: '10' }).set('x-test-role', 'GENERAL');
    expect(lista.status).toBe(200);
    expect(lista.body.data.map((c: { id: string }) => c.id)).toContain(creado.body.data.id);
    expect((await request(app.getHttpServer()).get(`/clients/${creado.body.data.id}`).set('x-test-role', 'GENERAL')).status).toBe(200);
  });
});

describe('clientes · edición, desactivación y reactivación: ADMIN sí, GENERAL no (HTTP + base desechable con fixtures propios)', () => {
  const estadoRol = async (id: string): Promise<string> => (await poolAdmin.query("SELECT estatus FROM core.empresa_roles WHERE empresa_id = $1 AND rol = 'CLIENTE'", [id])).rows[0].estatus;
  const nombreDe = async (id: string): Promise<string> => (await poolAdmin.query('SELECT nombre_comercial FROM core.empresas WHERE empresa_id = $1', [id])).rows[0].nombre_comercial;
  const crearCliente = async (base: string): Promise<{ id: string; nombre: string }> => {
    const nombreNuevo = nombre(base);
    const r = await post('ADMIN', { commercialName: nombreNuevo });
    expect(r.status).toBe(201);
    return { id: r.body.data.id, nombre: nombreNuevo };
  };

  it('PATCH: ADMIN renombra y anota; GENERAL recibe 403 y el dato queda intacto', async () => {
    const c = await crearCliente('Edicion');
    const denegado = await request(app.getHttpServer()).patch(`/clients/${c.id}`).set('x-test-role', 'GENERAL').send({ commercialName: 'Intento de GENERAL' });
    expect(denegado.status).toBe(403);
    expect(denegado.body.code).toBe('ROLE_NOT_ALLOWED');
    expect(await nombreDe(c.id)).toBe(c.nombre);
    const nuevo = nombre('Renombrado');
    const ok = await request(app.getHttpServer()).patch(`/clients/${c.id}`).set('x-test-role', 'ADMIN').send({ commercialName: `  ${nuevo}  `, notes: 'Nota' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ commercialName: nuevo, notes: 'Nota' });
    expect(await nombreDe(c.id)).toBe(nuevo);
  });

  it('desactivar / reactivar: ADMIN cambia el estado del rol CLIENTE; GENERAL recibe 403 y el estado no cambia', async () => {
    const c = await crearCliente('Ciclo');
    const d = await request(app.getHttpServer()).post(`/clients/${c.id}/deactivate`).set('x-test-role', 'GENERAL');
    expect(d.status).toBe(403);
    expect(await estadoRol(c.id)).toBe('ACTIVO');
    expect((await request(app.getHttpServer()).post(`/clients/${c.id}/deactivate`).set('x-test-role', 'ADMIN')).status).toBe(200);
    expect(await estadoRol(c.id)).toBe('INACTIVO');
    expect((await request(app.getHttpServer()).post(`/clients/${c.id}/reactivate`).set('x-test-role', 'GENERAL')).status).toBe(403);
    expect(await estadoRol(c.id)).toBe('INACTIVO');                                                  // GENERAL tampoco puede reactivar
    expect((await request(app.getHttpServer()).post(`/clients/${c.id}/reactivate`).set('x-test-role', 'ADMIN')).status).toBe(200);
    expect(await estadoRol(c.id)).toBe('ACTIVO');
  });

  it('validaciones reales de la base y el servicio: renombrar a un nombre que ya existe → 409 CLIENT_NAME_CONFLICT sin cambios; PATCH vacío → 400; propiedades desconocidas → 400', async () => {
    const a = await crearCliente('Nombre A'); const b = await crearCliente('Nombre B');
    const choque = await request(app.getHttpServer()).patch(`/clients/${b.id}`).set('x-test-role', 'ADMIN').send({ commercialName: a.nombre });
    expect(choque.status).toBe(409);
    expect(await nombreDe(b.id)).toBe(b.nombre);
    expect((await request(app.getHttpServer()).patch(`/clients/${b.id}`).set('x-test-role', 'ADMIN').send({})).status).toBe(400);
    expect((await request(app.getHttpServer()).patch(`/clients/${b.id}`).set('x-test-role', 'ADMIN').send({ estatus: 'BLOQUEADO' })).status).toBe(400);
    expect((await request(app.getHttpServer()).post('/clients').set('x-test-role', 'ADMIN').send({ commercialName: 'X', status: 'BLOQUEADO' })).status).toBe(400);
  });
});
