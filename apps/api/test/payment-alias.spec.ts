import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AliasesService } from '../src/aliases/aliases.service';
import { CreatePaymentAliasDto } from '../src/aliases/dto/create-payment-alias.dto';
import { normalizePaymentAlias, requiresPermanentAliasConfirmation } from '../src/aliases/payment-alias';

describe('permanent payment aliases', () => {
  const identity = { userId: '1', userEmail: 'test@example.test' };

  it.each([
    {}, { alias: 1800006184145 }, { alias: '' }, { alias: 'A'.repeat(301) },
    { alias: 'ACME', confirmPermanent: 'true' }, { alias: 'ACME', estatus: 'INACTIVO' },
    { alias: 'ACME', normalizedAlias: 'FORGED' }, { alias: 'ACME', companyId: '2' }
  ])('rejects invalid or forged payloads %#', async (input) => {
    expect(await validate(plainToInstance(CreatePaymentAliasDto, input), { whitelist: true, forbidNonWhitelisted: true })).not.toHaveLength(0);
  });

  it.each([
    ['  Ácme, S.A. de C.V.  ', 'ACME S A DE C V'],
    ['B+ASC', 'B ASC'], ['B_ASC', 'B ASC'], ['1800006184145', '1800006184145'],
    ['ñandú\t  méxico', 'NANDU MEXICO']
  ])('normalizes %s exactly as the n8n classifier', (alias, expected) => {
    expect(normalizePaymentAlias(alias)).toBe(expected);
  });

  it.each(['1800006184145', 'FACTURA 123', 'TEMPORAL ACME', 'ACME 20261019001', '550E8400 E29B 41D4 A716 446655440000'])('requires explicit confirmation for %s', async (alias) => {
    const repository = { createPaymentAlias: vi.fn() };
    const service = new AliasesService(repository as never);
    expect(requiresPermanentAliasConfirmation(normalizePaymentAlias(alias))).toBe(true);
    await expect(service.createPaymentAlias('1', { alias }, 'r', identity)).rejects.toMatchObject({ response: { code: 'PERMANENT_ALIAS_CONFIRMATION_REQUIRED' } });
    expect(repository.createPaymentAlias).not.toHaveBeenCalled();
  });

  it('persists the reviewed value and server-derived normalization after confirmation', async () => {
    const repository = { createPaymentAlias: vi.fn().mockResolvedValue({ companyId: '1' }) };
    await new AliasesService(repository as never).createPaymentAlias('1', { alias: ' 1800006184145 ', confirmPermanent: true }, 'r', identity);
    expect(repository.createPaymentAlias).toHaveBeenCalledWith('1', '1800006184145', '1800006184145', 'r', identity);
  });

  it('rejects punctuation-only aliases and maps missing companies and DB unique conflicts', async () => {
    const repository = { createPaymentAlias: vi.fn().mockResolvedValue(null) };
    const service = new AliasesService(repository as never);
    await expect(service.createPaymentAlias('1', { alias: ' --- ' }, 'r', identity)).rejects.toMatchObject({ status: 400 });
    await expect(service.createPaymentAlias('1', { alias: 'ACME' }, 'r', identity)).rejects.toMatchObject({ status: 404 });
    repository.createPaymentAlias.mockRejectedValue({ code: '23505', constraint: 'uq_alias_empresa_activo' });
    await expect(service.createPaymentAlias('1', { alias: 'ACME' }, 'r', identity)).rejects.toMatchObject({ status: 409, response: { code: 'ALIAS_ALREADY_ASSOCIATED' } });
  });
});
