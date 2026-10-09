import { ValidationPipe, UnauthorizedException, type CanActivate, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { AuditController } from '../src/audit/audit.controller';
import { AuditModule } from '../src/audit/audit.module';
import { AuditRepository } from '../src/audit/audit.repository';
import { AuditService } from '../src/audit/audit.service';
import { ListAuditEventsDto } from '../src/audit/dto/list-audit-events.dto';
import { SafeExceptionFilter } from '../src/common/http-exception.filter';
import { ROLES_KEY } from '../src/security/route-access.decorators';
import { RolesGuard } from '../src/security/roles.guard';

// Stands in for AuthGuard only: the role comes from a test header, no header = no session.
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string>; user?: unknown }>();
    const role = req.headers['x-test-role'];
    if (!role) throw new UnauthorizedException('No autenticado.');
    req.user = { id: '1', displayName: 'T', email: 't@x.mx', role, status: 'ACTIVE', mustChangePassword: false };
    return true;
  }
}

const sourceRow = {
  cambio_id: '10', fecha: '2026-10-05T15:00:00.000Z', esquema: 'security', tabla: 'users', registro_id: 'user_id=7', operacion: 'UPDATE',
  usuario_id: '1', usuario_email: 'admin@daubertcromwell.com', origen: 'DAUBERT_HUB', request_id: 'req-1',
  datos_anteriores: { role: 'GENERAL', password_hash: 'HASH-OLD' }, datos_nuevos: { role: 'ADMIN', password_hash: 'HASH-NEW', password_changed: true }
};

describe('AuditController (HTTP, real RolesGuard)', () => {
  let app: INestApplication;
  const repository = { list: vi.fn(), findById: vi.fn(), findActorDisplayNames: vi.fn() };

  beforeAll(async () => {
    // vitest/esbuild does not emit decorator metadata (the real build does), so declare the constructor and route parameter types by hand.
    Reflect.defineMetadata('design:paramtypes', [AuditService], AuditController);
    Reflect.defineMetadata('design:paramtypes', [ListAuditEventsDto], AuditController.prototype, 'list');
    Reflect.defineMetadata('design:paramtypes', [String], AuditController.prototype, 'detail');
    const module = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [
        { provide: AuditRepository, useValue: repository },
        // Factories because vitest/esbuild does not emit decorator metadata (the real build does).
        { provide: AuditService, useFactory: (repo: AuditRepository) => new AuditService(repo), inject: [AuditRepository] },
        { provide: APP_GUARD, useClass: FakeAuthGuard },
        { provide: APP_GUARD, useFactory: (reflector: Reflector) => new RolesGuard(reflector), inject: [Reflector] }
      ]
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new SafeExceptionFilter());
    await app.init();
  });
  afterAll(async () => app.close());

  beforeEach(() => {
    repository.list.mockReset().mockResolvedValue({ rows: [sourceRow], total: 1 });
    repository.findById.mockReset().mockResolvedValue(sourceRow);
    repository.findActorDisplayNames.mockReset().mockResolvedValue(new Map([['1', 'Ana Admin']]));
  });

  it('declares the ADMIN role on the whole controller', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AuditController)).toEqual(['ADMIN']);
  });

  it('401 without a session', async () => {
    await request(app.getHttpServer()).get('/api/audit/events').expect(401);
    await request(app.getHttpServer()).get('/api/audit/events/10').expect(401);
  });

  it('403 for GENERAL on both endpoints, without touching the database', async () => {
    const list = await request(app.getHttpServer()).get('/api/audit/events').set('x-test-role', 'GENERAL').expect(403);
    expect(list.body.code).toBe('ROLE_NOT_ALLOWED');
    await request(app.getHttpServer()).get('/api/audit/events/10').set('x-test-role', 'GENERAL').expect(403);
    expect(repository.list).not.toHaveBeenCalled();
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('ADMIN lists events with data + pagination meta', async () => {
    const response = await request(app.getHttpServer()).get('/api/audit/events?page=1&pageSize=10').set('x-test-role', 'ADMIN').expect(200);
    expect(response.body.meta).toEqual({ page: 1, pageSize: 10, total: 1, totalPages: 1 });
    expect(response.body.data[0]).toMatchObject({ id: '10', action: 'UPDATE', entity: { key: 'USER' }, requestId: 'req-1', actor: { displayName: 'Ana Admin' } });
  });

  it('passes query filters and pagination to the repository', async () => {
    await request(app.getHttpServer())
      .get('/api/audit/events?page=2&pageSize=5&from=2026-10-01T06:00:00.000Z&to=2026-10-02T06:00:00.000Z&userId=1&entity=USER&action=UPDATE')
      .set('x-test-role', 'ADMIN').expect(200);
    expect(repository.list).toHaveBeenCalledWith({ from: '2026-10-01T06:00:00.000Z', to: '2026-10-02T06:00:00.000Z', userId: '1', entity: 'USER', action: 'UPDATE' }, 2, 5);
  });

  it.each(['pageSize=500', 'page=0', 'action=INSERT', 'entity=NOPE', 'userId=abc', 'from=ayer', 'foo=bar'])('400 for invalid query %s', async (query) => {
    await request(app.getHttpServer()).get(`/api/audit/events?${query}`).set('x-test-role', 'ADMIN').expect(400);
  });

  it('400 for an inverted date range', async () => {
    await request(app.getHttpServer()).get('/api/audit/events?from=2026-10-08T00:00:00.000Z&to=2026-10-01T00:00:00.000Z').set('x-test-role', 'ADMIN').expect(400);
  });

  it('ADMIN gets event detail as field/before/after and no sensitive data anywhere in either response', async () => {
    const detail = await request(app.getHttpServer()).get('/api/audit/events/10').set('x-test-role', 'ADMIN').expect(200);
    expect(detail.body.data.changes).toEqual([
      { field: 'role', label: 'Rol', before: 'GENERAL', after: 'ADMIN' },
      { field: 'password_changed', label: 'Contraseña modificada', before: null, after: 'Sí' }
    ]);
    const list = await request(app.getHttpServer()).get('/api/audit/events').set('x-test-role', 'ADMIN').expect(200);
    for (const text of [JSON.stringify(detail.body), JSON.stringify(list.body)]) {
      for (const leaked of ['HASH-OLD', 'HASH-NEW', 'password_hash', 'datos_anteriores', 'datos_nuevos']) expect(text).not.toContain(leaked);
    }
  });

  it('404 for an unknown event and 400 for a malformed id', async () => {
    repository.findById.mockResolvedValue(null);
    await request(app.getHttpServer()).get('/api/audit/events/999').set('x-test-role', 'ADMIN').expect(404);
    await request(app.getHttpServer()).get('/api/audit/events/abc').set('x-test-role', 'ADMIN').expect(400);
    await request(app.getHttpServer()).get('/api/audit/events/9223372036854775808').set('x-test-role', 'ADMIN').expect(400);
  });
});

describe('AuditModule wiring', () => {
  it('is registered in AppModule', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule)).toContain(AuditModule);
  });
});
