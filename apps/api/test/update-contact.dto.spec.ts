import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UpdateContactDto } from '../src/contacts/dto/update-contact.dto';

async function payload(input: object) {
  const dto = plainToInstance(UpdateContactDto, input);
  return { dto, errors: await validate(dto, { whitelist: true, forbidNonWhitelisted: true }) };
}

describe('UpdateContactDto', () => {
  it('trims values and normalizes blank optional strings to null', async () => {
    const result = await payload({ name: '  María López  ', area: '  ', position: ' Compradora Sr. ', notes: '' });
    expect(result.errors).toHaveLength(0);
    expect(result.dto).toEqual({ name: 'María López', area: null, position: 'Compradora Sr.', notes: null });
  });

  it.each(['companyId', 'contactType', 'status', 'isPrimary', 'methods'])('rejects immutable field %s', async (field) => {
    expect((await payload({ [field]: 'forbidden' })).errors.length).toBeGreaterThan(0);
  });
});
