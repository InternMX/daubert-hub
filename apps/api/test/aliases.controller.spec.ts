import { describe, expect, it, vi } from 'vitest';
import { AliasesController } from '../src/aliases/aliases.controller';

describe('AliasesController', () => {
  it('passes an exact alias snapshot and server audit identity to management', async () => {
    const managePaymentAlias = vi.fn();
    const controller = new AliasesController({ managePaymentAlias } as never);
    const input = { action: 'REASSIGN' as const, companyId: '122', expectedCompanyId: '121', expectedUpdatedAt: '2026-10-19 10:00:00.123456+00', confirmed: true };
    await controller.managePaymentAlias('9007199254740993', input, { requestId: 'manage-1', user: { id: '42', email: 'actor@example.test' } } as never);
    expect(managePaymentAlias).toHaveBeenCalledWith('9007199254740993', input, 'manage-1', { userId: '42', userEmail: 'actor@example.test' });
  });

  it.each(['0', '01', '-1', '9223372036854775808'])('rejects invalid alias ID %s before management', (id) => {
    const managePaymentAlias = vi.fn();
    const controller = new AliasesController({ managePaymentAlias } as never);
    expect(() => controller.managePaymentAlias(id, { action: 'DEACTIVATE', expectedCompanyId: '121', expectedUpdatedAt: 'v', confirmed: true }, {} as never)).toThrow(expect.objectContaining({ status: 400 }));
    expect(managePaymentAlias).not.toHaveBeenCalled();
  });

  it('forwards permanent assignment and server-derived audit identity without losing bigint precision', async () => {
    const createPaymentAlias = vi.fn();
    const controller = new AliasesController({ createPaymentAlias } as never);
    const input = { alias: '1800006184145', confirmPermanent: true };
    await controller.createPaymentAlias('9007199254740993', input, { requestId: 'r', user: { id: '42', email: 'user@example.test' } } as never);
    expect(createPaymentAlias).toHaveBeenCalledWith('9007199254740993', input, 'r', { userId: '42', userEmail: 'user@example.test' });
  });

  it.each(['0', '-1', '01', '1.0', 'abc', '9223372036854775808'])('rejects invalid company ID %s on permanent assignment', (id) => {
    const createPaymentAlias = vi.fn();
    const controller = new AliasesController({ createPaymentAlias } as never);
    expect(() => controller.createPaymentAlias(id, { alias: 'Acme' }, { requestId: 'r' } as never)).toThrow(expect.objectContaining({ status: 400 }));
    expect(createPaymentAlias).not.toHaveBeenCalled();
  });

  it('passes exact bigint company id strings and nullable identity independently per request', async () => {
    const replace = vi.fn().mockResolvedValue({ data: { aliases: ['BMASC'], otherAliases: [] } });
    const controller = new AliasesController({ replace } as never);
    await controller.replace('9007199254740993', { aliases: ['BMASC'] }, { requestId: 'alias-1', user: { id: '42', email: 'user@example.test' } } as never);
    expect(replace).toHaveBeenCalledWith('9007199254740993', ['BMASC'], 'alias-1', { userId: '42', userEmail: 'user@example.test' });
  });

  it('passes the exact bigint company id string to list', async () => {
    const list = vi.fn().mockResolvedValue({ data: { aliases: [], otherAliases: [] } });
    const controller = new AliasesController({ list } as never);
    await controller.list('9007199254740993');
    expect(list).toHaveBeenCalledWith('9007199254740993');
  });

  it.each(['0', '-1', '01', '1.0', 'abc', '9223372036854775808'])('rejects invalid company ID %s on list', (id) => {
    const controller = new AliasesController({ list: vi.fn() } as never);
    expect(() => controller.list(id)).toThrow(expect.objectContaining({ status: 400 }));
  });

  it.each(['0', '-1', '01', '1.0', 'abc', '9223372036854775808'])('rejects invalid company ID %s on replace', (id) => {
    const controller = new AliasesController({ replace: vi.fn() } as never);
    expect(() => controller.replace(id, { aliases: [] }, { requestId: 'alias-2' } as never)).toThrow(expect.objectContaining({ status: 400 }));
  });
});
