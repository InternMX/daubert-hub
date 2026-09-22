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

  // Phase 12A.3 §F: no @Roles(...) anywhere on this controller — every authenticated route with
  // no declared roles stays open to both ADMIN and GENERAL (RolesGuard), and this module is
  // read-only operational monitoring, not automation administration.
  it('declares no @Roles(...) restriction on the controller class or any handler — open to both ADMIN and GENERAL', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CaterpillarController)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, CaterpillarController.prototype.listSeries)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, CaterpillarController.prototype.listExecutions)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, CaterpillarController.prototype.getExecutionDetail)).toBeUndefined();
  });

  // Phase 12A.3 §E: read-only module — every @Get/@Post/etc-decorated route handler on this
  // controller is GET, and there are exactly three of them (assertExecutionId is a private helper,
  // not a route, so it deliberately carries no METHOD_METADATA at all).
  it('exposes no write route (POST/PATCH/PUT/DELETE) — every declared route handler is GET', () => {
    const proto = CaterpillarController.prototype as unknown as Record<string, object>;
    const routeHandlers = Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor')
      .filter((name) => Reflect.getMetadata(METHOD_METADATA, proto[name]!) !== undefined);
    expect(routeHandlers.sort()).toEqual(['getExecutionDetail', 'listExecutions', 'listSeries'].sort());
    for (const name of routeHandlers) {
      expect(Reflect.getMetadata(METHOD_METADATA, proto[name]!)).toBe(RequestMethod.GET);
    }
  });
});
