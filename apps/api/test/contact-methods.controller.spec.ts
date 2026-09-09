import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { ContactMethodsController, ContactMethodsForContactsController } from '../src/contact-methods/contact-methods.controller';
import { ContactMethodType } from '../src/contacts/dto/create-contact.dto';

const request = { requestId: 'request-method', user: { id: '42', email: 'admin@example.test' } } as never;

describe('ContactMethods controllers', () => {
  it('adds a contact method with the original BIGINT contact ID and audit identity', async () => {
    const add = vi.fn().mockResolvedValue({ data: { id: '205' } });
    const controller = new ContactMethodsForContactsController({ add } as never);
    const id = '9007199254740993';
    const input = { type: ContactMethodType.Email, value: 'safe@example.test' };

    await controller.add(id, input, request);

    expect(add).toHaveBeenCalledWith(id, input, 'request-method', { userId: '42', userEmail: 'admin@example.test' });
    expect(typeof add.mock.calls[0]?.[0]).toBe('string');
  });

  it.each(['edit', 'deactivate', 'reactivate'] as const)('preserves a large BIGINT string in %s', async (operation) => {
    const id = '9007199254740993';
    const handler = vi.fn().mockResolvedValue({ data: { id } });
    const controller = new ContactMethodsController({ [operation]: handler } as never);

    if (operation === 'edit') await controller.edit(id, { value: 'corrected@example.test' }, request);
    if (operation === 'deactivate') await controller.deactivate(id, request);
    if (operation === 'reactivate') await controller.reactivate(id, request);

    expect(handler.mock.calls[0]?.[0]).toBe(id);
    expect(typeof handler.mock.calls[0]?.[0]).toBe('string');
  });

  it.each(['0', '-1', '1.5', 'abc', ' 1', '1e3'])('rejects invalid contact-method lifecycle ID %s with 400', (id) => {
    const service = { deactivate: vi.fn(), reactivate: vi.fn() };
    const controller = new ContactMethodsController(service as never);

    expect(() => controller.deactivate(id, request)).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => controller.reactivate(id, request)).toThrow(expect.objectContaining({ status: 400 }));
    expect(service.deactivate).not.toHaveBeenCalled();
    expect(service.reactivate).not.toHaveBeenCalled();
  });

  it('rejects overflow before add, edit, deactivate, or reactivate can delegate', () => {
    const overflow = '9223372036854775808';
    const add = vi.fn();
    const addController = new ContactMethodsForContactsController({ add } as never);
    const service = { edit: vi.fn(), deactivate: vi.fn(), reactivate: vi.fn() };
    const controller = new ContactMethodsController(service as never);

    expect(() => addController.add(overflow, { type: ContactMethodType.Email, value: 'safe@example.test' }, request)).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => controller.edit(overflow, { value: 'corrected@example.test' }, request)).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => controller.deactivate(overflow, request)).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => controller.reactivate(overflow, request)).toThrow(expect.objectContaining({ status: 400 }));
    expect(add).not.toHaveBeenCalled();
    expect(service.edit).not.toHaveBeenCalled();
    expect(service.deactivate).not.toHaveBeenCalled();
    expect(service.reactivate).not.toHaveBeenCalled();
  });

  it('keeps contact-method routes at their documented HTTP codes', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, ContactMethodsForContactsController.prototype.add)).toBe(201);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, ContactMethodsController.prototype.edit)).toBe(200);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, ContactMethodsController.prototype.deactivate)).toBe(200);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, ContactMethodsController.prototype.reactivate)).toBe(200);
  });
});
