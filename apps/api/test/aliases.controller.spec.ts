import { describe, expect, it, vi } from 'vitest';
import { AliasesController } from '../src/aliases/aliases.controller';

describe('AliasesController', () => {
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
