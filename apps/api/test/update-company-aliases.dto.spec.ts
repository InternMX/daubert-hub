import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UpdateCompanyAliasesDto } from '../src/aliases/dto/update-company-aliases.dto';

const validateStrict = (value: object) => validate(plainToInstance(UpdateCompanyAliasesDto, value), { whitelist: true, forbidNonWhitelisted: true });

describe('UpdateCompanyAliasesDto', () => {
  it('trims aliases and accepts an empty array to clear them', async () => {
    const input = plainToInstance(UpdateCompanyAliasesDto, { aliases: [' BMASC ', 'B+ASC'] });
    expect(await validate(input)).toHaveLength(0);
    expect(input.aliases).toEqual(['BMASC', 'B+ASC']);
    expect(await validateStrict({ aliases: [] })).toHaveLength(0);
  });

  it.each([
    { aliases: ['', 'BMASC'] },
    { aliases: ['Daubert', 'daubert'] },
    { aliases: 'BMASC' },
    { unsupported: true }
  ])('rejects invalid payload %#', async (value) => {
    expect(await validateStrict(value)).not.toHaveLength(0);
  });
});
