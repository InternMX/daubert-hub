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
});
