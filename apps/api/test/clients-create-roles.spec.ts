import 'reflect-metadata';
import { CanActivate, ExecutionContext, INestApplication, Injectable, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientsController } from '../src/clients/clients.controller';
import { CreateClientDto } from '../src/clients/dto/create-client.dto';
import { ListClientsDto } from '../src/clients/dto/list-clients.dto';
import { UpdateClientDto } from '../src/clients/dto/update-client.dto';
import { SafeExceptionFilter } from '../src/common/http-exception.filter';
import { createGlobalValidationPipe } from '../src/config/validation-pipe';
import { RolesGuard } from '../src/security/roles.guard';
import { emitirTiposDeParametros } from './support/design-metadata';

// HTTP real (Nest + supertest) con la CONFIGURACIÓN EFECTIVA de la API (ValidationPipe global y SafeExceptionFilter de main.ts) y el RolesGuard global verdadero: todas las operaciones que modifican datos
// maestros de clientes (POST, PATCH, desactivar, reactivar) son solo de ADMIN aunque se llame al endpoint directamente. La autenticación se simula con un guard mínimo (`x-test-role`).
emitirTiposDeParametros(ClientsController, { list: [ListClientsDto], detail: [String], create: [CreateClientDto, Object], update: [String, UpdateClientDto, Object], deactivate: [String, Object], reactivate: [String, Object] });

@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const role = req.headers['x-test-role'];
    if (!role) throw new UnauthorizedException();
    req.requestId = 'req-1';
    req.user = { id: role === 'ADMIN' ? '1' : '2', email: `${String(role).toLowerCase()}@example.test`, displayName: String(role), role, status: 'ACTIVE', mustChangePassword: false };
    return true;
  }
}

const servicio = { list: vi.fn(), detail: vi.fn(), create: vi.fn(), update: vi.fn(), deactivate: vi.fn(), reactivate: vi.fn() };
// vitest (esbuild) no emite los metadatos de inyección: el controlador real se instancia con el servicio simulado, conservando sus rutas y su @Roles.
class ControladorDePrueba extends ClientsController { constructor() { super(servicio as never); } }
let app: INestApplication;
const api = () => request(app.getHttpServer());
beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    controllers: [ControladorDePrueba],
    providers: [{ provide: APP_GUARD, useClass: FakeAuthGuard }, { provide: APP_GUARD, useFactory: (reflector: Reflector) => new RolesGuard(reflector), inject: [Reflector] }]
  }).compile();
  app = modulo.createNestApplication();
  app.useGlobalPipes(createGlobalValidationPipe());
  app.useGlobalFilters(new SafeExceptionFilter());
  await app.init();
});
afterAll(async () => { await app.close(); });
beforeEach(() => {
  vi.clearAllMocks();
  servicio.create.mockResolvedValue({ data: { id: '900' } });
  servicio.update.mockResolvedValue({ data: { id: '5' } });
  servicio.deactivate.mockResolvedValue({ data: { id: '5' } });
  servicio.reactivate.mockResolvedValue({ data: { id: '5' } });
  servicio.list.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
  servicio.detail.mockResolvedValue({ data: { id: '5' } });
});

const OPERACIONES = [
  { nombre: 'POST /clients (alta)', llamar: (rol: string) => api().post('/clients').set('x-test-role', rol).send({ commercialName: 'Nuevo SA' }), mock: 'create', estado: 201 },
  { nombre: 'PATCH /clients/:id (edición)', llamar: (rol: string) => api().patch('/clients/5').set('x-test-role', rol).send({ notes: 'nota' }), mock: 'update', estado: 200 },
  { nombre: 'POST /clients/:id/deactivate', llamar: (rol: string) => api().post('/clients/5/deactivate').set('x-test-role', rol).send(), mock: 'deactivate', estado: 200 },
  { nombre: 'POST /clients/:id/reactivate', llamar: (rol: string) => api().post('/clients/5/reactivate').set('x-test-role', rol).send(), mock: 'reactivate', estado: 200 }
] as const;

describe('clientes · las operaciones que modifican datos maestros son solo de ADMIN (backend, configuración efectiva)', () => {
  it.each(OPERACIONES)('$nombre: ADMIN lo ejecuta y el servicio recibe la identidad de la sesión', async ({ llamar, mock, estado }) => {
    const r = await llamar('ADMIN');
    expect(r.status).toBe(estado);
    expect(servicio[mock]).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(servicio[mock].mock.calls[0])).toContain('"userId":"1"');
  });

  it.each(OPERACIONES)('$nombre: GENERAL recibe 403 ROLE_NOT_ALLOWED llamando directamente al endpoint y no se ejecuta nada', async ({ llamar, mock }) => {
    const r = await llamar('GENERAL');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('ROLE_NOT_ALLOWED');
    expect(servicio[mock]).not.toHaveBeenCalled();
  });

  it.each(OPERACIONES)('$nombre: sin sesión → 401', async ({ llamar }) => {
    expect((await llamar('')).status).toBe(401);
  });

  it('el rechazo por rol ocurre ANTES de validar el cuerpo: un GENERAL no obtiene pistas de validación', async () => {
    const r = await api().post('/clients').set('x-test-role', 'GENERAL').send({ campoDesconocido: true });
    expect(r.status).toBe(403);
    expect(servicio.create).not.toHaveBeenCalled();
  });

  it('GENERAL conserva la consulta de clientes (lista y detalle)', async () => {
    expect((await api().get('/clients').set('x-test-role', 'GENERAL')).status).toBe(200);
    expect((await api().get('/clients/5').set('x-test-role', 'GENERAL')).status).toBe(200);
    expect(servicio.list).toHaveBeenCalled();
    expect(servicio.detail).toHaveBeenCalledWith('5');
  });
});

describe('clientes · DTO con la configuración efectiva (ValidationPipe global): transformación y validación REALES', () => {
  it('transforma: recorta el nombre, pasa el RFC a MAYÚSCULAS y normaliza las notas vacías a null antes de llegar al servicio', async () => {
    const r = await api().post('/clients').set('x-test-role', 'ADMIN').send({ commercialName: '  Acme SA  ', fiscal: { legalName: '  Acme SA de CV ', rfc: 'abc010101aaa' }, notes: '   ' });
    expect(r.status).toBe(201);
    const entrada = servicio.create.mock.calls[0]![0];
    expect(entrada).toBeInstanceOf(CreateClientDto);
    expect(entrada.commercialName).toBe('Acme SA');
    expect(entrada.fiscal).toMatchObject({ legalName: 'Acme SA de CV', rfc: 'ABC010101AAA' });
    expect(entrada.notes).toBeNull();
  });

  it('valida: nombre vacío, RFC de longitud inválida o con espacios y propiedades desconocidas (p. ej. status) responden 400 sin llegar al servicio', async () => {
    const mala = (cuerpo: Record<string, unknown>) => api().post('/clients').set('x-test-role', 'ADMIN').send(cuerpo);
    expect((await mala({ commercialName: '   ' })).status).toBe(400);
    expect((await mala({ commercialName: 'X', fiscal: { legalName: 'X SA', rfc: 'CORTO' } })).status).toBe(400);
    expect((await mala({ commercialName: 'X', fiscal: { legalName: 'X SA', rfc: 'ABC 10101 AAA' } })).status).toBe(400);
    expect((await mala({ commercialName: 'X', status: 'BLOQUEADO' })).status).toBe(400);              // forbidNonWhitelisted
    expect((await mala({ commercialName: 'X', fiscal: { legalName: 'X SA', rfc: 'ABC010101AAA', extra: 1 } })).status).toBe(400);   // también en el objeto anidado
    expect(servicio.create).not.toHaveBeenCalled();
  });

  it('PATCH usa el mismo pipeline: transforma el cuerpo y rechaza propiedades desconocidas', async () => {
    const ok = await api().patch('/clients/5').set('x-test-role', 'ADMIN').send({ commercialName: '  Renombrada  ' });
    expect(ok.status).toBe(200);
    expect(servicio.update.mock.calls[0]![1].commercialName).toBe('Renombrada');
    expect((await api().patch('/clients/5').set('x-test-role', 'ADMIN').send({ roles: ['CLIENTE'] })).status).toBe(400);
  });
});
