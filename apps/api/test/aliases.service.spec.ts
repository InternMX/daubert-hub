import { describe, expect, it, vi } from 'vitest';
import { AliasesService } from '../src/aliases/aliases.service';

const identity = { userId: null, userEmail: null };

describe('AliasesService', () => {
  it('returns aliases for an existing company', async () => {
    const repository = { list: vi.fn().mockResolvedValue({ aliases: ['BMASC'], otherAliases: [{ alias: 'ACME FILE', type: 'NOMBRE_ARCHIVO' }] }) };
    const service = new AliasesService(repository as never);
    await expect(service.list('9007199254740993')).resolves.toEqual({ data: { aliases: ['BMASC'], otherAliases: [{ alias: 'ACME FILE', type: 'NOMBRE_ARCHIVO' }] } });
  });

  it('returns 404 when the company does not exist', async () => {
    const service = new AliasesService({ list: vi.fn().mockResolvedValue(null) } as never);
    await expect(service.list('1')).rejects.toMatchObject({ status: 404 });
  });

  it('trims aliases and rejects case-insensitive duplicates before repository access', async () => {
    const replace = vi.fn().mockResolvedValue({ aliases: ['BMASC'], otherAliases: [] });
    const service = new AliasesService({ replace } as never);
    await service.replace('121', [' BMASC '], 'request-1', identity);
    expect(replace).toHaveBeenCalledWith('121', ['BMASC'], 'request-1', identity);
    await expect(service.replace('121', ['Daubert', 'daubert'], 'request-1', identity)).rejects.toMatchObject({ status: 400 });
    await expect(service.replace('121', [''], 'request-1', identity)).rejects.toMatchObject({ status: 400 });
  });

  it('returns 404 when replacing aliases for a company that does not exist', async () => {
    const service = new AliasesService({ replace: vi.fn().mockResolvedValue(null) } as never);
    await expect(service.replace('1', ['BMASC'], 'request-1', identity)).rejects.toMatchObject({ status: 404 });
  });

  it('maps the alias-already-associated conflict from the pre-check', async () => {
    const service = new AliasesService({ replace: vi.fn().mockRejectedValue({ code: 'ALIAS_ALREADY_ASSOCIATED' }) } as never);
    await expect(service.replace('121', ['TAKEN'], 'request-1', identity)).rejects.toMatchObject({ status: 409, response: { code: 'ALIAS_ALREADY_ASSOCIATED' } });
  });

  it('maps the active alias uniqueness constraint to a safe conflict', async () => {
    const service = new AliasesService({ replace: vi.fn().mockRejectedValue({ code: '23505', constraint: 'uq_alias_empresa_activo' }) } as never);
    await expect(service.replace('121', ['TAKEN'], 'request-1', identity)).rejects.toMatchObject({ status: 409, response: { code: 'ALIAS_ALREADY_ASSOCIATED', message: 'Este alias ya está asociado a otra empresa.' } });
  });
});
