import 'reflect-metadata';
import { CanActivate, ExecutionContext, INestApplication, Injectable, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientsController } from '../src/clients/clients.controller';
import { RolesGuard } from '../src/security/roles.guard';

// HTTP real (Nest + supertest) con el RolesGuard GLOBAL verdadero: el alta de clientes es solo de ADMIN aunque se llame al endpoint directamente (sin interfaz). La autenticación se simula con un
// guard mínimo que lee la cabecera `x-test-role` (el AuthGuard real está cubierto en sus propias pruebas).
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
beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    controllers: [ControladorDePrueba],
    providers: [{ provide: APP_GUARD, useClass: FakeAuthGuard }, { provide: APP_GUARD, useFactory: (reflector: Reflector) => new RolesGuard(reflector), inject: [Reflector] }]
  }).compile();
  app = modulo.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
});
afterAll(async () => { await app.close(); });
beforeEach(() => {
  vi.clearAllMocks();
  servicio.create.mockResolvedValue({ data: { id: '900', commercialName: 'Nuevo SA' } });
  servicio.list.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
  servicio.detail.mockResolvedValue({ data: { id: '1' } });
});

describe('POST /clients · solo ADMIN (backend)', () => {
  it('ADMIN crea el cliente (201) y el servicio recibe la identidad de la sesión', async () => {
    const r = await request(app.getHttpServer()).post('/clients').set('x-test-role', 'ADMIN').send({ commercialName: 'Nuevo SA' });
    expect(r.status).toBe(201);
    expect(servicio.create).toHaveBeenCalledTimes(1);
    expect(servicio.create).toHaveBeenCalledWith(expect.objectContaining({ commercialName: 'Nuevo SA' }), 'req-1', { userId: '1', userEmail: 'admin@example.test' });
  });

  it('GENERAL recibe 403 ROLE_NOT_ALLOWED llamando directamente al endpoint y NO se crea nada, ni siquiera con datos válidos o con RFC', async () => {
    for (const cuerpo of [{ commercialName: 'Nuevo SA' }, { commercialName: 'Otro', fiscal: { legalName: 'Otro SA', rfc: 'OTR010101AAA' } }]) {
      const r = await request(app.getHttpServer()).post('/clients').set('x-test-role', 'GENERAL').send(cuerpo);
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('ROLE_NOT_ALLOWED');
    }
    expect(servicio.create).not.toHaveBeenCalled();
  });

  it('sin sesión: 401; y el rechazo por rol ocurre antes de validar el cuerpo (un GENERAL no obtiene pistas de validación)', async () => {
    expect((await request(app.getHttpServer()).post('/clients').send({ commercialName: 'X' })).status).toBe(401);
    const r = await request(app.getHttpServer()).post('/clients').set('x-test-role', 'GENERAL').send({});
    expect(r.status).toBe(403);
    expect(servicio.create).not.toHaveBeenCalled();
  });

  it('GENERAL conserva la consulta de clientes (lista y detalle); no cambia ninguna otra ruta', async () => {
    expect((await request(app.getHttpServer()).get('/clients').set('x-test-role', 'GENERAL')).status).toBe(200);
    expect((await request(app.getHttpServer()).get('/clients/1').set('x-test-role', 'GENERAL')).status).toBe(200);
    expect(servicio.list).toHaveBeenCalled();
    expect(servicio.detail).toHaveBeenCalledWith('1');
  });
});
