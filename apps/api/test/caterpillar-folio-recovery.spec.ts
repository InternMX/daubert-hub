import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { RolesGuard } from '../src/security/roles.guard';
import { CaterpillarFolioRecoveryController, PrepareFolioRecoveryDto } from '../src/automations/remisiones-caterpillar/caterpillar-folio-recovery.controller';
import { CaterpillarFolioRecoveryService } from '../src/automations/remisiones-caterpillar/caterpillar-folio-recovery.service';

describe('Caterpillar recovery — disabled defaults, ADMIN and isolated preparation contract', () => {
  let app: INestApplication;
  let enabled: boolean;
  let database: string;
  const query = vi.fn();
  const route = '/automations/remissions/caterpillar/executions/10000/folio-recovery';
  const body = { requestId: '264d0c3c-a917-4104-8c0e-9f01b818c2db', reason: 'Synthetic no-delivery confirmation', confirmedNoDelivery: true };
  beforeEach(async () => {
    enabled = false; database = 'daubert_hub_test'; query.mockReset();
    // Vitest/esbuild omits decorator metadata; match the existing cancellation HTTP test setup.
    Reflect.defineMetadata('design:paramtypes', [CaterpillarFolioRecoveryService], CaterpillarFolioRecoveryController);
    Reflect.defineMetadata('design:paramtypes', [DatabaseService, ConfigService], CaterpillarFolioRecoveryService);
    Reflect.defineMetadata('design:paramtypes', [String, PrepareFolioRecoveryDto, Object], CaterpillarFolioRecoveryController.prototype, 'prepare');
    const module = await Test.createTestingModule({ controllers: [CaterpillarFolioRecoveryController], providers: [CaterpillarFolioRecoveryService,
      { provide: DatabaseService, useValue: { query } },
      { provide: ConfigService, useValue: { get: (key: string) => key === 'database' ? { name: database } : enabled } }
    ] }).compile();
    app = module.createNestApplication();
    app.use((req: { headers: Record<string, string>; user?: unknown }, _res: unknown, next: () => void) => {
      if (req.headers['x-synthetic-role']) req.user = { id: '10000', role: req.headers['x-synthetic-role'] };
      next();
    });
    app.useGlobalGuards(new RolesGuard(new Reflector()));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  afterEach(async () => { await app.close(); });
  it('requires authentication and ADMIN on both routes before accessing SQL', async () => {
    await request(app.getHttpServer()).get(route).expect(401);
    await request(app.getHttpServer()).get(route).set('x-synthetic-role', 'GENERAL').expect(403);
    await request(app.getHttpServer()).post(route).set('x-synthetic-role', 'GENERAL').send(body).expect(403);
    expect(query).not.toHaveBeenCalled();
  });
  it('defaults disabled and rejects preparation without touching SQL', async () => {
    const r = await request(app.getHttpServer()).get(route).set('x-synthetic-role', 'ADMIN').expect(200);
    expect(r.body.codes).toEqual(['FEATURE_DISABLED']);
    await request(app.getHttpServer()).post(route).set('x-synthetic-role', 'ADMIN').send(body).expect(409);
    expect(query).not.toHaveBeenCalled();
  });
  it('a TEST flag cannot enable production', async () => {
    enabled = true; database = 'daubert_global';
    const r = await request(app.getHttpServer()).get(route).set('x-synthetic-role', 'ADMIN').expect(200);
    expect(r.body.enabled).toBe(false);
    await request(app.getHttpServer()).post(route).set('x-synthetic-role', 'ADMIN').send(body).expect(409);
    expect(query).not.toHaveBeenCalled();
  });
  it('reports an uninstalled migration without trying an unavailable function', async () => {
    enabled = true; query.mockResolvedValue([{ installed: false }]);
    const r = await request(app.getHttpServer()).get(route).set('x-synthetic-role', 'ADMIN').expect(200);
    expect(r.body.codes).toEqual(['MIGRATION_NOT_INSTALLED']); expect(query).toHaveBeenCalledTimes(1);
  });
  it('returns database checks and quarantine summary, including later-reservation refusal', async () => {
    enabled = true; query.mockResolvedValueOnce([{ installed: true }]).mockResolvedValueOnce([{ assessment: {
      enabled: false, databaseEligible: false, eligible: false, codes: ['LATER_RESERVATION'], firstFolio: '111', lastFolio: '114', quarantine: { state: 'NOT_PREPARED', sha256: null, fileCount: 0 }
    } }]);
    const r = await request(app.getHttpServer()).get(route).set('x-synthetic-role', 'ADMIN').expect(200);
    expect(r.body.codes).toEqual(['LATER_RESERVATION']); expect(r.body.firstFolio).toBe('111');
  });
  it.each([{ ...body, confirmedNoDelivery: false }, { ...body, reason: '   ' }, { ...body, adminId: '666' }, { ...body, requestId: 'not-a-uuid' }])('rejects missing confirmation, blank reason and caller-supplied identity', async input => {
    enabled = true;
    await request(app.getHttpServer()).post(route).set('x-synthetic-role', 'ADMIN').send(input).expect(400);
    expect(query).not.toHaveBeenCalled();
  });
  it('binds the idempotent request to server identity and never invokes a conventional reprocess', async () => {
    enabled = true; query.mockResolvedValue([{ result: { requestId: body.requestId, state: 'PREPARING' } }]);
    for (let i = 0; i < 2; i++) {
      const r = await request(app.getHttpServer()).post(route).set('x-synthetic-role', 'ADMIN').send(body).expect(202);
      expect(r.body).toEqual({ requestId: body.requestId, state: 'PREPARING' });
    }
    expect(query).toHaveBeenCalledWith(expect.stringContaining('cat_recovery_test.request'), ['10000', body.requestId, '10000', body.reason, true]);
    expect(query.mock.calls.every(call => call[0].includes('cat_recovery_test.request'))).toBe(true);
  });
  it('sanitizes unavailable SQL and never forwards internals to the caller', async () => {
    enabled = true; query.mockRejectedValue(new Error('password=DO_NOT_EXPOSE internal.table'));
    const r = await request(app.getHttpServer()).post(route).set('x-synthetic-role', 'ADMIN').send(body).expect(503);
    expect(JSON.stringify(r.body)).not.toContain('DO_NOT_EXPOSE'); expect(JSON.stringify(r.body)).not.toContain('internal.table');
  });
});
