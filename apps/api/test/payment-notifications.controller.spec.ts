import { describe, expect, it, vi } from 'vitest';
import { PaymentNotificationsController } from '../src/automations/payment-notifications/payment-notifications.controller';

describe('PaymentNotificationsController', () => {
  it('delegates list() with the parsed query DTO', async () => {
    const list = vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } });
    const controller = new PaymentNotificationsController({ list } as never);
    await controller.list({ page: 2, pageSize: 10 });
    expect(list).toHaveBeenCalledWith({ page: 2, pageSize: 10 });
  });

  it('delegates getDetail() with an exact BIGINT-safe id string, never a Number', async () => {
    const getDetail = vi.fn().mockResolvedValue({ data: {} });
    const controller = new PaymentNotificationsController({ getDetail } as never);
    await controller.getDetail('9007199254740993');
    expect(getDetail).toHaveBeenCalledWith('9007199254740993');
    expect(typeof getDetail.mock.calls[0]?.[0]).toBe('string');
  });

  it.each(['0', '-1', '01', '1.0', 'abc', '', '9223372036854775808'])('rejects invalid executionId %s', (executionId) => {
    const controller = new PaymentNotificationsController({ getDetail: vi.fn() } as never);
    expect(() => controller.getDetail(executionId)).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('accepts the maximum valid int8 executionId', async () => {
    const getDetail = vi.fn().mockResolvedValue({ data: {} });
    const controller = new PaymentNotificationsController({ getDetail } as never);
    await expect(controller.getDetail('9223372036854775807')).resolves.toEqual({ data: {} });
  });

  // PN1.2 final scope cleanup: "Ejecutar ahora" (RUN) was removed from Payment Notifications —
  // the production n8n workflow already polls independently, so a manual trigger for it added no
  // value. No POST /run route remains on this controller.
  it('no longer exposes a run() method or a /run route handler', () => {
    const controller = new PaymentNotificationsController({} as never);
    expect((controller as unknown as Record<string, unknown>).run).toBeUndefined();
  });

  describe('reprocess (PN1.2 targeting fix §4/§9)', () => {
    it('delegates to service.reprocess with the exact executionId, requestId and identity, never a correo_id, returning TRIGGERED', async () => {
      const reprocess = vi.fn().mockResolvedValue({ status: 'TRIGGERED' });
      const controller = new PaymentNotificationsController({ reprocess } as never);
      const request = { requestId: 'req-1', user: { id: '5', email: 'user@daubert.mx' } };
      const result = await controller.reprocess('32', request as never);
      expect(reprocess).toHaveBeenCalledWith('32', 'req-1', { userId: '5', userEmail: 'user@daubert.mx' });
      expect(reprocess.mock.calls[0]?.length).toBe(3);
      expect(result).toEqual({ status: 'TRIGGERED' });
    });

    it.each(['0', '-1', '01', '1.0', 'abc', '', '9223372036854775808'])('rejects invalid executionId %s before calling the service', async (executionId) => {
      const reprocess = vi.fn();
      const controller = new PaymentNotificationsController({ reprocess } as never);
      const request = { requestId: 'req-x', user: { id: '5', email: 'user@daubert.mx' } };
      await expect(controller.reprocess(executionId, request as never)).rejects.toEqual(expect.objectContaining({ status: 400 }));
      expect(reprocess).not.toHaveBeenCalled();
    });

    it('throws a 404 NotFoundException when the service reports NOT_FOUND (executionId does not exist)', async () => {
      const reprocess = vi.fn().mockResolvedValue({ status: 'NOT_FOUND' });
      const controller = new PaymentNotificationsController({ reprocess } as never);
      const request = { requestId: 'req-2', user: { id: '5', email: 'user@daubert.mx' } };
      await expect(controller.reprocess('999999', request as never)).rejects.toEqual(expect.objectContaining({ status: 404 }));
    });

    it('throws a 409 ConflictException when the service reports NOT_ELIGIBLE (execution exists but is no longer reprocessable)', async () => {
      const reprocess = vi.fn().mockResolvedValue({ status: 'NOT_ELIGIBLE' });
      const controller = new PaymentNotificationsController({ reprocess } as never);
      const request = { requestId: 'req-2b', user: { id: '5', email: 'user@daubert.mx' } };
      await expect(controller.reprocess('32', request as never)).rejects.toEqual(expect.objectContaining({ status: 409 }));
    });

    it('throws a 502 BadGatewayException when the service reports UPSTREAM_ERROR', async () => {
      const reprocess = vi.fn().mockResolvedValue({ status: 'UPSTREAM_ERROR' });
      const controller = new PaymentNotificationsController({ reprocess } as never);
      const request = { requestId: 'req-3', user: { id: '5', email: 'user@daubert.mx' } };
      await expect(controller.reprocess('32', request as never)).rejects.toEqual(expect.objectContaining({ status: 502 }));
    });
  });
});
