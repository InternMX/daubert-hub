import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UpdateProviderDto } from '../src/providers/dto/update-provider.dto';

describe('UpdateProviderDto aliases', () => {
  it('trims valid aliases', async () => {
    const input = plainToInstance(UpdateProviderDto, { aliases: [' BMASC ', 'B+ASC'] });
    expect(await validate(input)).toHaveLength(0);
    expect(input.aliases).toEqual(['BMASC', 'B+ASC']);
  });

  it.each([
    { aliases: [''] },
    { aliases: ['   '] },
    { aliases: ['Daubert', 'daubert'] },
    { aliases: ['Daubert', 1] },
    { aliases: 'Daubert' }
  ])('rejects invalid aliases %#', async (value) => {
    expect(await validate(plainToInstance(UpdateProviderDto, value))).not.toHaveLength(0);
  });
});
