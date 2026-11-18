import { UnauthorizedException, ValidationPipe, type CanActivate, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudiExecutionsController } from '../src/automations/remisiones-audi/audi-executions.controller';
import { AudiExecutionsService } from '../src/automations/remisiones-audi/audi-executions.service';
import { AudiRecoveryRepository } from '../src/automations/remisiones-audi/audi-recovery.repository';
import { AudiRecoveryService } from '../src/automations/remisiones-audi/audi-recovery.service';
import { AudiRecoveryWebhookClient } from '../src/automations/remisiones-audi/audi-recovery-webhook.client';
import { AudiRecoveryActionDto, AudiRecoveryRevisionActionDto } from '../src/automations/remisiones-audi/dto/audi-recovery-action.dto';
import { SafeExceptionFilter } from '../src/common/http-exception.filter';
import { RequestIdMiddleware } from '../src/common/request-id.middleware';
import { RolesGuard } from '../src/security/roles.guard';

class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const role = req.headers['x-test-role'];
    if (!role) throw new UnauthorizedException();
    req.user = { role, id: '9007199254740995' };
    return true;
  }
}

const executionId = '9007199254740993';
const actionId = '9007199254740994';
const base = '/api/automations/remissions/audi/executions/';
const routes = [
  ['reprocess', 'REPROCESS', AudiRecoveryActionDto],
  ['reconcile', 'RECONCILE', AudiRecoveryRevisionActionDto],
  ['stop', 'STOP', AudiRecoveryActionDto],
  ['cancel', 'CANCEL', AudiRecoveryRevisionActionDto]
] as const;
const active = { outcome: 'AUTHORIZED', accion_id: actionId, revision: 'ERROR:0', attempt_estado: 'EN_CURSO', claimed: false };
const storedAttempt = {
  accion_id: actionId, accion: 'RECONCILE', estado: 'EN_CURSO', claimed: false, motivo: 'Motivo original',
  actor_nombre: 'Operador', codigo_resultado: null, error: 'C:\\private\\secret.pdf',
  token_fencing: 'hidden-fence', resultado: { path: 'C:\\private\\secret.pdf' }
};

describe('Audi recovery HTTP with SQL and webhook doubles', () => {
  let app: INestApplication;
  let configured = true;
  const query = vi.fn();
  const dispatch = vi.fn();
  const executions = {
    findById: vi.fn().mockResolvedValue({
      ejecucion_id: executionId, execution_state: 'ERROR', started_at: '2026-11-18T00:00:00Z',
      finished_at: null, n8n_execution_id: '16061', reprocess_of_execution_id: '5', child_execution_id: '6',
      error_message: null, source_filename: null
    }),
    findRemissionsByExecutionId: vi.fn().mockResolvedValue([])
  };

  function post(route: string, role = 'ADMIN', id = executionId) {
    return request(app.getHttpServer()).post(base + id + '/' + route).set('x-test-role', role);
  }

  beforeAll(async () => {
    const webhook = new AudiRecoveryWebhookClient({ get: () => ({ url: configured ? 'http://example.invalid' : null, token: 'test' }) } as never);
    vi.spyOn(webhook, 'dispatch').mockImplementation(dispatch);
    const recovery = new AudiRecoveryService(new AudiRecoveryRepository({ query } as never), webhook, executions as never);
    Reflect.defineMetadata('design:paramtypes', [AudiExecutionsService, AudiRecoveryService], AudiExecutionsController);
    for (const [route, , dto] of routes) {
      Reflect.defineMetadata('design:paramtypes', [String, dto, Object, Object], AudiExecutionsController.prototype, route);
    }
    const module = await Test.createTestingModule({
      controllers: [AudiExecutionsController],
      providers: [
        { provide: AudiExecutionsService, useValue: new AudiExecutionsService(executions as never, {} as never, recovery) },
        { provide: AudiRecoveryService, useValue: recovery },
        { provide: APP_GUARD, useClass: FakeAuthGuard },
        { provide: APP_GUARD, useFactory: (reflector: Reflector) => new RolesGuard(reflector), inject: [Reflector] }
      ]
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new SafeExceptionFilter());
    const requestId = new RequestIdMiddleware();
    app.use(requestId.use.bind(requestId));
    await app.init();
  });

  afterAll(async () => app.close());

  beforeEach(() => {
    configured = true;
    query.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([active]);
    dispatch.mockReset().mockResolvedValue({ kind: 'ACCEPTED', status: 'DISPATCHED' });
  });

  it.each(routes)('rejects GENERAL on %s before SQL', async (route) => {
    await post(route, 'GENERAL').send({ reason: 'Motivo' }).expect(403);
    expect(query).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each(routes)('allows ADMIN on %s, binding the trusted actor and request id after sweep', async (route, action, dto) => {
    const revision = dto === AudiRecoveryRevisionActionDto ? 'ERROR:0' : null;
    if (action === 'STOP') dispatch.mockResolvedValue({ kind: 'ACCEPTED', status: 'STOP_REQUESTED' });
    const result = await post(route).set('x-request-id', 'client-id')
      .send({ reason: '  Motivo  ', ...(revision ? { expectedRevision: revision } : {}) }).expect(202);
    expect(result.body.data).toEqual({ accepted: true, status: action === 'STOP' ? 'STOP_REQUESTED' : 'DISPATCHED', actionId, executionId });
    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('fn_expirar_acciones_audi_test'), []);
    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('accion_id::text'), [
      executionId, action, 'Motivo', revision, '9007199254740995', result.headers['x-request-id']
    ]);
    expect(result.headers['x-request-id']).not.toBe('client-id');
    expect(dispatch).toHaveBeenCalledWith({ action, actionId, executionId, reason: 'Motivo' });
  });

  it.each([
    ['reprocess', '0', { reason: 'Valid' }],
    ['stop', '9223372036854775808', { reason: 'Valid' }],
    ['stop', executionId, { reason: '   ' }],
    ['stop', executionId, { reason: 'a'.repeat(501) }],
    ['reprocess', executionId, { reason: 5 }],
    ['reprocess', executionId, { reason: 'Motivo', actorId: '1' }],
    ['cancel', executionId, { reason: 'Motivo' }],
    ['reconcile', executionId, { reason: 'Motivo', expectedRevision: 42 }]
  ] as const)('rejects invalid id or body on %s (%s)', async (route, id, body) => {
    await post(route, 'ADMIN', id).send(body).expect(400);
    expect(query).not.toHaveBeenCalled();
  });

  it.each(['unknown', 'Caterpillar'])('maps the SQL NOT_FOUND for a %s execution to 404', async () => {
    query.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([{ outcome: 'NOT_FOUND' }]);
    const { body } = await post('stop').send({ reason: 'Motivo' }).expect(404);
    expect(body.code).toBe('NOT_FOUND');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('returns 503 before any SQL if the webhook is unconfigured', async () => {
    configured = false;
    const { body } = await post('stop').send({ reason: 'Motivo' }).expect(503);
    expect(body.code).toBe('INTEGRATION_NOT_CONFIGURED');
    expect(query).not.toHaveBeenCalled();
  });

  it.each(['42883', '42P01'])('maps missing SQL object %s to 503 on POST', async (code) => {
    query.mockReset().mockRejectedValue({ code });
    const { body } = await post('stop').send({ reason: 'Motivo' }).expect(503);
    expect(body.code).toBe('RECOVERY_NOT_INSTALLED');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([['TIMEOUT', 504], ['NETWORK_ERROR', 502], ['INVALID_RESPONSE', 502]] as const)(
    'returns a safe %s response with the action id and preserves the attempt', async (kind, status) => {
      dispatch.mockResolvedValue({ kind, raw: 'private-secret' });
      const { body } = await post('stop').send({ reason: 'Motivo' }).expect(status);
      expect(body).toEqual({ statusCode: status, code: kind, message: expect.any(String), actionId });
      if (kind === 'TIMEOUT') {
        expect(body.message).toBe('No se pudo confirmar el resultado; revisa el historial antes de reintentar.');
      }
      expect(JSON.stringify(body)).not.toContain('private-secret');
      expect(query).toHaveBeenCalledTimes(2);
    }
  );

  it('closes a definitively rejected dispatch and maps the rejection', async () => {
    dispatch.mockResolvedValue({ kind: 'REJECTED', reason: 'STALE_ATTEMPT' });
    query.mockResolvedValueOnce([{ outcome: 'FALLIDA' }]);
    const { body } = await post('stop').send({ reason: 'Motivo' }).expect(409);
    expect(body.code).toBe('STALE_ATTEMPT');
    expect(query).toHaveBeenNthCalledWith(3, expect.stringContaining('fn_fallar_despacho_accion_audi_test'), [actionId, 'STALE_ATTEMPT']);
  });

  it('returns the active attempt if SQL reports that a worker claimed it during dispatch', async () => {
    dispatch.mockResolvedValue({ kind: 'REJECTED', reason: 'NOT_ELIGIBLE_STATE' });
    query.mockResolvedValueOnce([{ outcome: 'ACTION_IN_PROGRESS' }]);
    const { body } = await post('stop').send({ reason: 'Motivo' }).expect(200);
    expect(body.data).toMatchObject({ status: 'ACTION_IN_PROGRESS', actionId });
  });

  it('re-dispatches the same SQL attempt with its original action and reason across concurrent requests', async () => {
    let authorizations = 0;
    query.mockReset().mockImplementation(async (sql: string) => {
      if (sql.includes('fn_expirar')) return [];
      if (sql.includes('fn_autorizar')) return [{ ...active, outcome: ++authorizations === 1 ? 'AUTHORIZED' : 'ACTION_IN_PROGRESS' }];
      return [{ detail: { attempts: [storedAttempt] } }];
    });
    const first = post('reconcile').send({ reason: storedAttempt.motivo, expectedRevision: 'ERROR:0' });
    const second = post('reconcile').send({ reason: 'Otro motivo', expectedRevision: 'ERROR:0' });
    // Hold the second request until SQL receives the first, without waiting for its processing to end.
    let authorizationStarted!: () => void;
    const started = new Promise<void>((resolve) => { authorizationStarted = resolve; });
    let finishDispatch!: () => void;
    const pending = new Promise<void>((resolve) => { finishDispatch = resolve; });
    dispatch.mockImplementationOnce(async () => {
      authorizationStarted();
      await pending;
      return { kind: 'ACCEPTED', status: 'DISPATCHED' };
    });
    const firstResponse = first.expect(202).then((value) => value);
    await started;
    try {
      const repeated = await second.expect(200);
      expect(repeated.body.data).toMatchObject({ status: 'ACTION_IN_PROGRESS', actionId });
      expect(dispatch.mock.calls).toEqual(Array.from({ length: 2 }, () => [{
        executionId, actionId, action: 'RECONCILE', reason: storedAttempt.motivo
      }]));
      const ids = query.mock.calls.filter(([sql]) => sql.includes('fn_autorizar')).map(([, args]) => args[5]);
      expect(new Set(ids).size).toBe(2);
    } finally {
      finishDispatch();
      await firstResponse;
    }
  });

  it.each([
    [{ outcome: 'ACTION_IN_PROGRESS', claimed: true }, 'ACTION_IN_PROGRESS', true],
    [{ attempt_estado: 'FALLIDA' }, 'FALLIDA', false],
    [{ attempt_estado: 'EXPIRADA' }, 'EXPIRADA', false],
    [{ attempt_estado: 'COMPLETADA' }, 'COMPLETADA', true],
    [{ outcome: 'ALREADY_COMPLETED', accion_id: null }, 'ALREADY_COMPLETED', true]
  ] as const)('returns the SQL outcome without dispatch for %j', async (fields, status, accepted) => {
    query.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...active, ...fields }]);
    const { body } = await post('reconcile').send({ reason: 'Motivo', expectedRevision: 'ERROR:0' }).expect(200);
    expect(body.data).toMatchObject({ accepted, status, actionId: 'accion_id' in fields ? null : actionId });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each(['ADMIN', 'GENERAL'])('keeps detail available without 108 for %s', async (role) => {
    query.mockReset().mockRejectedValue({ code: '42883' });
    const { body } = await request(app.getHttpServer()).get(base + executionId).set('x-test-role', role).expect(200);
    expect(body.data).toMatchObject({
      model: null, revision: null, reservation: null, artifacts: [], recoveryAttempts: [],
      n8nExecutionId: '16061', reprocessOfExecutionId: '5', childExecutionId: '6'
    });
    expect(body.data.availableActions).toHaveLength(4);
    for (const action of body.data.availableActions) {
      expect(action).toMatchObject({ enabled: false, disabledReason: role === 'ADMIN' ? 'RECOVERY_NOT_INSTALLED' : 'FORBIDDEN' });
    }
  });

  it('sanitizes artifact and attempt detail and preserves SQL eligibility', async () => {
    configured = false;
    query.mockReset().mockResolvedValue([{ detail: {
      model: 'ATOMIC', revision: 'ERROR:5', reservation: { firstFolio: '988', lastFolio: '990', quantity: 3, status: 'RESERVADA' },
      attempts: [storedAttempt],
      artifacts: [{ fileName: 'C:\\private\\remision.pdf', ruta: '/private/remision.pdf', version: 2, current: true, actionId }],
      availableActions: [
        { action: 'RECONCILE', enabled: true, disabledReason: null },
        { action: 'REPROCESS', enabled: false, disabledReason: 'PARTIAL_ARTIFACTS' }
      ]
    } }]);
    const { body } = await request(app.getHttpServer()).get(base + executionId).set('x-test-role', 'ADMIN').expect(200);
    expect(body.data).toMatchObject({
      model: 'ATOMIC', artifacts: [{ fileName: 'remision.pdf', version: 2, current: true, actionId }],
      recoveryAttempts: [{ actionId, action: 'RECONCILE', status: 'EN_CURSO', reason: storedAttempt.motivo, error: expect.any(String) }]
    });
    expect(body.data.availableActions).toEqual(expect.arrayContaining([
      { action: 'RECONCILE', enabled: false, disabledReason: 'INTEGRATION_NOT_CONFIGURED' },
      { action: 'REPROCESS', enabled: false, disabledReason: 'PARTIAL_ARTIFACTS' }
    ]));
    expect(JSON.stringify(body)).not.toMatch(/private|secret|token_fencing|hidden-fence|resultado|ruta/);
  });
});
