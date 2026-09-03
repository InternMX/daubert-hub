import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateClientDto } from '../src/clients/dto/create-client.dto';
import { UpdateClientDto } from '../src/clients/dto/update-client.dto';

const validateStrict = (value: object, type: new () => object) =>
  validate(plainToInstance(type, value), { whitelist: true, forbidNonWhitelisted: true });

describe('Client DTOs', () => {
  it('normalizes names, RFC, and nullable notes', async () => {
    const input = plainToInstance(CreateClientDto, { commercialName: ' Acme ', fiscal: { legalName: ' Acme SA ', rfc: 'acm010101aa1' }, notes: '  ' });
    expect(await validate(input)).toHaveLength(0);
    expect(input).toMatchObject({ commercialName: 'Acme', fiscal: { legalName: 'Acme SA', rfc: 'ACM010101AA1' }, notes: null });
  });

  it.each([
    {},
    { commercialName: 'Acme', fiscal: { legalName: 'Acme SA' } },
    { commercialName: 'Acme', fiscal: { legalName: 'Acme SA', rfc: 'SHORT' } },
    { commercialName: 'Acme', unsupported: true }
  ])('rejects invalid create payload %#', async (value) => {
    expect(await validateStrict(value, CreateClientDto)).not.toHaveLength(0);
  });

  it('accepts provider-compatible fiscal history fields on update', async () => {
    const input = plainToInstance(UpdateClientDto, { fiscal: { legalName: ' Acme New ', rfc: 'new010101aa1', changeMode: 'NEW_IDENTITY', effectiveStartDate: '2026-09-03' } });
    expect(await validate(input)).toHaveLength(0);
    expect(input.fiscal).toMatchObject({ legalName: 'Acme New', rfc: 'NEW010101AA1' });
  });

  it('rejects unsupported update fields and malformed fiscal modes', async () => {
    expect(await validateStrict({ status: 'INACTIVO' }, UpdateClientDto)).not.toHaveLength(0);
    expect(await validateStrict({ fiscal: { changeMode: 'GUESS' } }, UpdateClientDto)).not.toHaveLength(0);
  });

  it('rejects a whitespace-only commercialName on update instead of turning it into NULL (B5)', async () => {
    expect(await validateStrict({ commercialName: '   ' }, UpdateClientDto)).not.toHaveLength(0);
  });

  it('normalizes blank notes to null on update, matching create (B6)', async () => {
    const input = plainToInstance(UpdateClientDto, { notes: '   ' });
    expect(await validate(input)).toHaveLength(0);
    expect(input.notes).toBeNull();
  });

  it('rejects a create RFC that contains internal whitespace despite matching length (B7)', async () => {
    expect(await validateStrict({ commercialName: 'Acme', fiscal: { legalName: 'Acme SA', rfc: 'ACM 0101 AA1' } }, CreateClientDto)).not.toHaveLength(0);
  });
});
