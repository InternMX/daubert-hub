import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { ROLES_KEY } from '../src/security/route-access.decorators';
import { CaterpillarController } from '../src/automations/remisiones-caterpillar/caterpillar.controller';

describe('CaterpillarController', () => {
  it('delegates listSeries() to the routing service with no arguments', async () => {
    const listSeries = vi.fn().mockResolvedValue({ data: [] });
    const controller = new CaterpillarController({ listSeries } as never, {} as never);
    await expect(controller.listSeries()).resolves.toEqual({ data: [] });
    expect(listSeries).toHaveBeenCalledWith();
  });

  it('delegates listExecutions() with the parsed query DTO', async () => {
    const list = vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } });
    const controller = new CaterpillarController({} as never, { list } as never);
    await controller.listExecutions({ page: 2, pageSize: 10 });
    expect(list).toHaveBeenCalledWith({ page: 2, pageSize: 10 });
  });

  it('delegates getExecutionDetail() with an exact BIGINT-safe id string, never a Number', async () => {
    const getDetail = vi.fn().mockResolvedValue({ data: {} });
    const controller = new CaterpillarController({} as never, { getDetail } as never);
    await controller.getExecutionDetail('9007199254740993');
    expect(getDetail).toHaveBeenCalledWith('9007199254740993');
    expect(typeof getDetail.mock.calls[0]?.[0]).toBe('string');
  });

  it.each(['0', '-1', '01', '1.0', 'abc', '', '9223372036854775808'])('rejects invalid executionId %s before calling the service', (executionId) => {
    const getDetail = vi.fn();
    const controller = new CaterpillarController({} as never, { getDetail } as never);
    expect(() => controller.getExecutionDetail(executionId)).toThrow(expect.objectContaining({ status: 400 }));
    expect(getDetail).not.toHaveBeenCalled();
  });

  it('accepts the maximum valid int8 executionId', async () => {
    const getDetail = vi.fn().mockResolvedValue({ data: {} });
    const controller = new CaterpillarController({} as never, { getDetail } as never);
    await expect(controller.getExecutionDetail('9223372036854775807')).resolves.toEqual({ data: {} });
  });

  // Phase 12A.3 §F, refined by Phase 12C: no @Roles(...) at the class level, and the three GET
  // routes stay open to both ADMIN and GENERAL (RolesGuard) — this module is still read-only
  // operational monitoring for consultation. Only the new reprocess route is administrative.
  it('declares no @Roles(...) restriction on the controller class or any GET handler — open to both ADMIN and GENERAL', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CaterpillarController)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, CaterpillarController.prototype.listSeries)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, CaterpillarController.prototype.listExecutions)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, CaterpillarController.prototype.getExecutionDetail)).toBeUndefined();
  });

  // Phase 12C: the one mutating route (manual reprocess) is ADMIN-only, mirroring
  // AutomationsController.adjustDocumentSeries' method-level @Roles('ADMIN') precedent.
  it('declares @Roles(\'ADMIN\') on the reprocess handler only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CaterpillarController.prototype.reprocess)).toEqual(['ADMIN']);
  });

  // Phase 12A.3 §E, refined by Phase 12C: the three original GET routes remain read-only; the one
  // new write route (POST executions/:executionId/reprocess) is the sole exception, and is ADMIN-only.
  it('exposes two ADMIN-only POST routes and keeps consultation GET-only', () => {
    const proto = CaterpillarController.prototype as unknown as Record<string, object>;
    const routeHandlers = Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor')
      .filter((name) => Reflect.getMetadata(METHOD_METADATA, proto[name]!) !== undefined);
    expect(routeHandlers.sort()).toEqual(['getExecutionDetail', 'listExecutions', 'listSeries', 'reprocess', 'cancelRemission'].sort());
    for (const name of routeHandlers) {
      const expected = name === 'reprocess' || name === 'cancelRemission' ? RequestMethod.POST : RequestMethod.GET;
      expect(Reflect.getMetadata(METHOD_METADATA, proto[name]!)).toBe(expected);
      if (expected === RequestMethod.POST) expect(Reflect.getMetadata(ROLES_KEY, proto[name]!)).toEqual(['ADMIN']);
    }
  });

  describe('reprocess', () => {
    function mockResponse() {
      return { status: vi.fn() };
    }

    it.each(['0', '-1', '01', '1.0', 'abc', '', '9223372036854775808'])('rejects invalid executionId %s before calling the service', async (executionId) => {
      const reprocess = vi.fn();
      const controller = new CaterpillarController({} as never, { reprocess } as never);
      await expect(controller.reprocess(executionId, { reason: 'motivo' }, { requestId: 'req-1' } as never, mockResponse() as never)).rejects.toMatchObject({ status: 400 });
      expect(reprocess).not.toHaveBeenCalled();
    });

    it('delegates to the service with executionId, reason, requestId, and the identity derived from the request', async () => {
      const reprocess = vi.fn().mockResolvedValue({ outcome: 'REPROCESS_CREATED', originalExecutionId: '153', executionId: '154' });
      const controller = new CaterpillarController({} as never, { reprocess } as never);
      const request = { requestId: 'req-1', user: { id: '9', email: 'admin@test.mx' } } as never;
      await controller.reprocess('153', { reason: 'motivo' }, request, mockResponse() as never);
      expect(reprocess).toHaveBeenCalledWith('153', 'motivo', 'req-1', { userId: '9', userEmail: 'admin@test.mx' });
    });

    it.each([
      ['REPROCESS_CREATED'],
      ['ALREADY_PROCESSING']
    ] as const)('returns the default 202 status and a stable response body for %s', async (status) => {
      const reprocess = vi.fn().mockResolvedValue({ outcome: status, originalExecutionId: '153', executionId: '154' });
      const controller = new CaterpillarController({} as never, { reprocess } as never);
      const response = mockResponse();
      const result = await controller.reprocess('153', { reason: 'motivo' }, { requestId: 'req-1' } as never, response as never);
      expect(result).toEqual({ accepted: true, originalExecutionId: '153', executionId: '154', status });
      expect(response.status).not.toHaveBeenCalled();
    });

    it('sets the response status to 200 for ALREADY_REPROCESSED, overriding the 202 default', async () => {
      const reprocess = vi.fn().mockResolvedValue({ outcome: 'ALREADY_REPROCESSED', originalExecutionId: '153', executionId: '154' });
      const controller = new CaterpillarController({} as never, { reprocess } as never);
      const response = mockResponse();
      const result = await controller.reprocess('153', { reason: 'motivo' }, { requestId: 'req-1' } as never, response as never);
      expect(response.status).toHaveBeenCalledWith(200);
      expect(result).toEqual({ accepted: true, originalExecutionId: '153', executionId: '154', status: 'ALREADY_REPROCESSED' });
    });

    it('throws NotFoundException for NOT_FOUND', async () => {
      const reprocess = vi.fn().mockResolvedValue({ outcome: 'NOT_FOUND', originalExecutionId: '153', executionId: null });
      const controller = new CaterpillarController({} as never, { reprocess } as never);
      await expect(controller.reprocess('153', { reason: 'motivo' }, { requestId: 'req-1' } as never, mockResponse() as never)).rejects.toMatchObject({ status: 404 });
    });

    it.each([
      ['NOT_ELIGIBLE_STATE'],
      ['SOURCE_DOCUMENT_MISSING'],
      ['SOURCE_FILE_UNCLASSIFIABLE_OR_MISSING'],
      ['SOURCE_FILE_MISSING'],
      ['OUTSIDE_TEST_SCOPE'],
      ['OUTSIDE_ALLOWED_SCOPE'],
      ['ADMISSION_REJECTED']
    ] as const)('throws ConflictException (409) for %s', async (outcome) => {
      const reprocess = vi.fn().mockResolvedValue({ outcome, originalExecutionId: '153', executionId: null });
      const controller = new CaterpillarController({} as never, { reprocess } as never);
      await expect(controller.reprocess('153', { reason: 'motivo' }, { requestId: 'req-1' } as never, mockResponse() as never)).rejects.toMatchObject({ status: 409 });
    });

    it.each([['OUTSIDE_TEST_SCOPE'], ['OUTSIDE_ALLOWED_SCOPE']] as const)('uses the same generic public message for %s, exposing neither the code nor any internal detail', async (outcome) => {
      const reprocess = vi.fn().mockResolvedValue({ outcome, originalExecutionId: '153', executionId: null });
      const controller = new CaterpillarController({} as never, { reprocess } as never);
      const rejection = controller.reprocess('153', { reason: 'motivo' }, { requestId: 'req-1' } as never, mockResponse() as never);
      await expect(rejection).rejects.toMatchObject({ status: 409, message: 'La ejecución no pertenece al ámbito permitido para este entorno.' });
      await expect(rejection).rejects.not.toThrow(/SCOPE|TEST|n8n|webhook/i);
    });

    it.each([
      ['SOURCE_DOCUMENT_MISSING', 'El documento origen no tiene la información necesaria para reprocesar.'],
      ['SOURCE_FILE_UNCLASSIFIABLE_OR_MISSING', 'El archivo origen no está disponible o no se puede clasificar para reprocesar.']
    ] as const)('sanitizes the documented %s rejection as an operational conflict', async (outcome, message) => {
      const reprocess = vi.fn().mockResolvedValue({ outcome, originalExecutionId: '153', executionId: null });
      const controller = new CaterpillarController({} as never, { reprocess } as never);
      await expect(controller.reprocess('153', { reason: 'motivo' }, { requestId: 'req-1' } as never, mockResponse() as never)).rejects.toMatchObject({ status: 409, message });
    });

    it('throws GatewayTimeoutException (504) for UPSTREAM_TIMEOUT', async () => {
      const reprocess = vi.fn().mockResolvedValue({ outcome: 'UPSTREAM_TIMEOUT', originalExecutionId: '153', executionId: null });
      const controller = new CaterpillarController({} as never, { reprocess } as never);
      await expect(controller.reprocess('153', { reason: 'motivo' }, { requestId: 'req-1' } as never, mockResponse() as never)).rejects.toMatchObject({ status: 504 });
    });

    it.each([
      ['UPSTREAM_UNAVAILABLE'],
      ['UPSTREAM_INVALID_RESPONSE']
    ] as const)('throws BadGatewayException (502) for %s', async (outcome) => {
      const reprocess = vi.fn().mockResolvedValue({ outcome, originalExecutionId: '153', executionId: null });
      const controller = new CaterpillarController({} as never, { reprocess } as never);
      await expect(controller.reprocess('153', { reason: 'motivo' }, { requestId: 'req-1' } as never, mockResponse() as never)).rejects.toMatchObject({ status: 502 });
    });
  });
});
