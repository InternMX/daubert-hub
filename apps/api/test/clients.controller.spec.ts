import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { ClientsController } from '../src/clients/clients.controller';

describe('ClientsController', () => {
  it.each(['detail', 'update', 'deactivate', 'reactivate'] as const)('preserves a BIGINT string in %s', async (operation) => {
    const id = '9007199254740993';
    const handler = vi.fn().mockResolvedValue({ data: { id } });
    const controller = new ClientsController({ [operation]: handler } as never);
    if (operation === 'detail') await controller.detail(id);
    if (operation === 'update') await controller.update(id, { notes: null }, { requestId: 'request-1' } as never);
    if (operation === 'deactivate') await controller.deactivate(id, { requestId: 'request-1' } as never);
    if (operation === 'reactivate') await controller.reactivate(id, { requestId: 'request-1' } as never);
    expect(handler.mock.calls[0]?.[0]).toBe(id);
  });

  it.each(['0', '01', '-1', '1.5', 'abc', ' 1', '9223372036854775808'])('rejects invalid client ID %s', (id) => {
    const detail = vi.fn();
    const controller = new ClientsController({ detail } as never);
    expect(() => controller.detail(id)).toThrow(expect.objectContaining({ status: 400 }));
    expect(detail).not.toHaveBeenCalled();
  });

  it('passes audit identity to every mutation and uses HTTP 200 for lifecycle routes', async () => {
    const service = { create: vi.fn(), update: vi.fn(), deactivate: vi.fn(), reactivate: vi.fn() };
    const controller = new ClientsController(service as never);
    const request = { requestId: 'request-1', user: { id: '42', email: 'user@example.test' } } as never;
    await controller.create({ commercialName: 'Acme' }, request);
    await controller.update('1', { notes: null }, request);
    await controller.deactivate('1', request);
    await controller.reactivate('1', request);
    const identity = { userId: '42', userEmail: 'user@example.test' };
    expect(service.create).toHaveBeenCalledWith({ commercialName: 'Acme' }, 'request-1', identity);
    expect(service.update).toHaveBeenCalledWith('1', { notes: null }, 'request-1', identity);
    expect(service.deactivate).toHaveBeenCalledWith('1', 'request-1', identity);
    expect(service.reactivate).toHaveBeenCalledWith('1', 'request-1', identity);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, ClientsController.prototype.deactivate)).toBe(200);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, ClientsController.prototype.reactivate)).toBe(200);
  });
});
