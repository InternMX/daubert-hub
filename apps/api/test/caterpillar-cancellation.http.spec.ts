import { ValidationPipe, UnauthorizedException, type CanActivate, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaterpillarController } from '../src/automations/remisiones-caterpillar/caterpillar.controller';
import { CaterpillarExecutionsService } from '../src/automations/remisiones-caterpillar/caterpillar-executions.service';
import { CaterpillarExecutionsRepository } from '../src/automations/remisiones-caterpillar/caterpillar-executions.repository';
import { CaterpillarRoutingService } from '../src/automations/remisiones-caterpillar/caterpillar-routing.service';
import { CancelCaterpillarRemissionDto } from '../src/automations/remisiones-caterpillar/dto/cancel-caterpillar-remission.dto';
import { SafeExceptionFilter } from '../src/common/http-exception.filter';
import { RolesGuard } from '../src/security/roles.guard';

// Auth boundary simulated; real RolesGuard, ValidationPipe, controller, service and exception filter.
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (!req.headers['x-test-role']) throw new UnauthorizedException('No autenticado.');
    req.user = { id: '1', email: 'admin@example.invalid', role: req.headers['x-test-role'] };
    req.requestId = 'request-cancel';
    return true;
  }
}
const revision = '2026-10-20T12:00:00.123456Z';
const body = { reason: 'Corrección', expectedRevision: revision };
const row = { resultado: 'CANCELLED', remision_id: '100', motivo: 'Corrección', cancelacion_id: '1', usuario_id: '1',
  usuario_email: 'admin@example.invalid', usuario_nombre: 'Admin', cancelada_en: revision, request_id: 'request-cancel' };
describe('Caterpillar cancellation HTTP (mock persistence, no external connections)', () => {
  let app: INestApplication;
  const cancelRemission = vi.fn();
  const url = '/api/automations/remissions/caterpillar/executions/14/remittances/100/cancel';
  beforeAll(async () => {
    Reflect.defineMetadata('design:paramtypes', [CaterpillarRoutingService, CaterpillarExecutionsService], CaterpillarController);
    Reflect.defineMetadata('design:paramtypes', [String, String, CancelCaterpillarRemissionDto, Object], CaterpillarController.prototype, 'cancelRemission');
    const module = await Test.createTestingModule({ controllers: [CaterpillarController], providers: [
      { provide: CaterpillarRoutingService, useValue: {} },
      { provide: CaterpillarExecutionsService, useFactory: () => new CaterpillarExecutionsService({ cancelRemission } as never, {} as never, {} as never, {} as never) },
      { provide: APP_GUARD, useClass: FakeAuthGuard },
      { provide: APP_GUARD, useFactory: (reflector: Reflector) => new RolesGuard(reflector), inject: [Reflector] }
    ] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new SafeExceptionFilter());
    await app.init();
  });
  afterAll(async () => app.close());
  beforeEach(() => { cancelRemission.mockReset().mockResolvedValue(row); });
  it('401 without authentication; no persistence call', async () => {
    await request(app.getHttpServer()).post(url).send(body).expect(401);
    expect(cancelRemission).not.toHaveBeenCalled();
  });
  it('403 for GENERAL; no persistence call', async () => {
    await request(app.getHttpServer()).post(url).set('x-test-role', 'GENERAL').send(body).expect(403);
    expect(cancelRemission).not.toHaveBeenCalled();
  });
  it('ADMIN gets only the safe cancellation response; trims reason and preserves revision microseconds', async () => {
    const response = await request(app.getHttpServer()).post(url).set('x-test-role', 'ADMIN').send({ ...body, reason: '  Corrección  ' }).expect(200);
    expect(cancelRemission).toHaveBeenCalledWith('14', '100', body, '1', 'request-cancel');
    expect(response.body).toEqual({ data: { status: 'CANCELLED', remissionId: '100', cancellationReason: 'Corrección', cancellation: {
      cancellationId: '1', userId: '1', userEmail: 'admin@example.invalid', userDisplayName: 'Admin', cancelledAt: revision, requestId: 'request-cancel'
    } } });
  });
  it.each([
    {}, { ...body, reason: '' }, { ...body, reason: '   ' }, { ...body, reason: 'x'.repeat(501) },
    { ...body, expectedRevision: '2026-10-20T12:00:00.123Z' }, { ...body, expectedRevision: 123 },
    { ...body, folio: '128' }, { ...body, seriesCode: 'REMISION_CAT_P5' }, { ...body, pdfPath: '/any' },
    { ...body, userId: '2' }, { ...body, usuario_id: '2' }, { ...body, requestId: 'client-controlled' }
  ])('rejects invalid or editable operational input (%j)', async (input) => {
    await request(app.getHttpServer()).post(url).set('x-test-role', 'ADMIN').send(input).expect(400);
    expect(cancelRemission).not.toHaveBeenCalled();
  });
  it('accepts exactly 500 characters', async () => {
    await request(app.getHttpServer()).post(url).set('x-test-role', 'ADMIN').send({ ...body, reason: 'x'.repeat(500) }).expect(200);
  });
  it.each(['0', '01', '-1', '9223372036854775808'])('rejects invalid remission ID %s', async (id) => {
    await request(app.getHttpServer()).post(url.replace('/100/', `/${id}/`)).set('x-test-role', 'ADMIN').send(body).expect(400);
    expect(cancelRemission).not.toHaveBeenCalled();
  });
  it.each([['PCA01',404], ['PCA02',409], ['PCA03',409], ['PCA04',409], ['PCA05',403], ['22023',400], ['42883',503], ['XX000',503]] as const)('maps SQLSTATE %s to HTTP %d without internal details', async (code, status) => {
      cancelRemission.mockRejectedValue(Object.assign(new Error('private SQL /path webhook credential'), { code }));
      const response = await request(app.getHttpServer()).post(url).set('x-test-role', 'ADMIN').send(body).expect(status);
      expect(JSON.stringify(response.body)).not.toMatch(/private|SQL|path|webhook|credential|PCA/);
    });
  it('returns idempotent ALREADY_CANCELLED and the original reason', async () => {
    cancelRemission.mockResolvedValue({ ...row, resultado: 'ALREADY_CANCELLED', motivo: 'Original' });
    const response = await request(app.getHttpServer()).post(url).set('x-test-role', 'ADMIN').send(body).expect(200);
    expect(response.body.data).toMatchObject({ status: 'ALREADY_CANCELLED', cancellationReason: 'Original' });
  });
});

describe('Caterpillar cancellation repository boundary', () => {
  it('uses the real query contract: one parameterized function call with exact string IDs/revision', async () => {
    const query = vi.fn().mockResolvedValue([row]);
    const repo = new CaterpillarExecutionsRepository({ query } as never);
    await expect(repo.cancelRemission('9007199254740993', '9007199254740994', body, '1', 'req')).resolves.toEqual(row);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual(['9007199254740993', '9007199254740994', revision, 'Corrección', '1', 'req']);
    expect(query.mock.calls[0]?.[0]).toContain('operacion.fn_cancelar_remision_caterpillar');
    expect(query.mock.calls[0]?.[0]).not.toMatch(/UPDATE|DELETE|INSERT/);
  });
  it('keeps detail consultation available before migration 013', async () => {
    const query = vi.fn().mockResolvedValue([{ available: false }]);
    const repo = new CaterpillarExecutionsRepository({ query } as never);
    await expect(repo.findCancellationAuditsByExecutionId('14')).resolves.toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
