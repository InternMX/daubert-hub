import { describe, expect, it, vi } from 'vitest';
import { AddressesController } from '../src/addresses/addresses.controller';

describe('AddressesController', () => {
  it('passes exact bigint strings and nullable identity independently per request', async () => {
    const update = vi.fn().mockResolvedValue({ data: { id: '9007199254740993' } });
    const controller = new AddressesController({ update } as never);
    await controller.update('9007199254740993', { calle: 'Reforma' }, { requestId: 'address-1', user: { id: '42', email: 'user@example.test' } } as never);
    expect(update).toHaveBeenCalledWith('9007199254740993', { calle: 'Reforma' }, 'address-1', { userId: '42', userEmail: 'user@example.test' });
  });

  it.each(['0', '-1', '01', '1.0', '9223372036854775808'])('rejects invalid address ID %s', (id) => {
    const controller = new AddressesController({ deactivate: vi.fn() } as never);
    expect(() => controller.deactivate(id, { requestId: 'address-2' } as never)).toThrow(expect.objectContaining({ status: 400 }));
  });
});
