import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { ContactsController } from '../src/contacts/contacts.controller';

describe('ContactsController lifecycle', () => {
  it.each([
    ['deactivate', '9223372036854775807'],
    ['reactivate', '9007199254740993']
  ] as const)('passes the exact string ID to %s and responds with HTTP 200', async (operation, id) => {
    const handler = vi.fn().mockResolvedValue({ data: { id } });
    const controller = new ContactsController({ [operation]: handler } as never);
    await expect(controller[operation](id, { requestId: 'request-status' } as never)).resolves.toMatchObject({ data: { id } });
    expect(handler).toHaveBeenCalledWith(id, 'request-status', { userId: null, userEmail: null });
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, ContactsController.prototype[operation])).toBe(200);
  });

  it.each(['0', '-1', '1.5', 'abc', ' 1', '01', '9223372036854775808'])('rejects invalid bigint contact ID %s', async (id) => {
    const deactivate = vi.fn();
    const controller = new ContactsController({ deactivate } as never);
    expect(() => controller.deactivate(id, { requestId: 'request-status' } as never)).toThrow(expect.objectContaining({ status: 400 }));
    expect(deactivate).not.toHaveBeenCalled();
  });
});
