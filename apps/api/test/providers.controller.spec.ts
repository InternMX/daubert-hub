import { ConflictException, NotFoundException } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { ProvidersController } from '../src/providers/providers.controller';

const request = { requestId: 'request-1', user: { id: '42', email: 'admin@example.test' } } as never;

describe('ProvidersController', () => {
  it('passes a normal string ID to provider detail', async () => {
    const get = vi.fn().mockResolvedValue({ data: { id: '121' } });
    const controller = new ProvidersController({ get } as never);

    await expect(controller.get('121')).resolves.toMatchObject({ data: { id: '121' } });
    expect(get).toHaveBeenCalledWith('121');
  });

  it.each(['get', 'update', 'deactivate', 'reactivate'] as const)('preserves a BIGINT-safe string in %s', async (operation) => {
    const id = '9007199254740993';
    const handler = vi.fn().mockResolvedValue({ data: { id } });
    const controller = new ProvidersController({ [operation]: handler } as never);

    if (operation === 'get') await controller.get(id);
    if (operation === 'update') await controller.update(id, { notes: null }, request);
    if (operation === 'deactivate') await controller.deactivate(id, request);
    if (operation === 'reactivate') await controller.reactivate(id, request);

    expect(handler.mock.calls[0]?.[0]).toBe(id);
    expect(typeof handler.mock.calls[0]?.[0]).toBe('string');
  });

  it.each(['0', '-1', '1.5', 'abc', ' 1', '1e3', '9223372036854775808'])('rejects invalid provider ID %s with 400', (id) => {
    const get = vi.fn();
    const controller = new ProvidersController({ get } as never);

    expect(() => controller.get(id)).toThrow(expect.objectContaining({ status: 400 }));
    expect(get).not.toHaveBeenCalled();
  });

  it.each(['update', 'deactivate', 'reactivate'] as const)('validates the ID before delegating %s', (operation) => {
    const handler = vi.fn();
    const controller = new ProvidersController({ [operation]: handler } as never);

    expect(() => {
      if (operation === 'update') controller.update('9223372036854775808', { notes: null }, request);
      if (operation === 'deactivate') controller.deactivate('9223372036854775808', request);
      if (operation === 'reactivate') controller.reactivate('9223372036854775808', request);
    }).toThrow(expect.objectContaining({ status: 400 }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('passes audit identity to mutations and keeps lifecycle routes at HTTP 200', async () => {
    const service = { create: vi.fn(), update: vi.fn(), deactivate: vi.fn(), reactivate: vi.fn() };
    const controller = new ProvidersController(service as never);
    const identity = { userId: '42', userEmail: 'admin@example.test' };

    await controller.create({ commercialName: 'Acme', providerType: 'PROVEEDOR' } as never, request);
    await controller.update('121', { notes: null }, request);
    await controller.deactivate('121', request);
    await controller.reactivate('121', request);

    expect(service.create).toHaveBeenCalledWith(expect.anything(), 'request-1', identity);
    expect(service.update).toHaveBeenCalledWith('121', { notes: null }, 'request-1', identity);
    expect(service.deactivate).toHaveBeenCalledWith('121', 'request-1', identity);
    expect(service.reactivate).toHaveBeenCalledWith('121', 'request-1', identity);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, ProvidersController.prototype.deactivate)).toBe(200);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, ProvidersController.prototype.reactivate)).toBe(200);
  });

  it.each([new NotFoundException('Proveedor no encontrado.'), new ConflictException({ code: 'PROVIDER_ALREADY_INACTIVE' })])('preserves service error mapping', async (error) => {
    const controller = new ProvidersController({ get: vi.fn().mockRejectedValue(error) } as never);
    await expect(controller.get('121')).rejects.toBe(error);
  });
});
