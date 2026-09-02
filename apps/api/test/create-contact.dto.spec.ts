import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ContactMethodType, ContactType, CreateContactDto } from '../src/contacts/dto/create-contact.dto';

async function validatePayload(payload: object): Promise<{ dto: CreateContactDto; errors: number }> {
  const dto = plainToInstance(CreateContactDto, payload);
  return { dto, errors: (await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length };
}

describe('CreateContactDto', () => {
  it('trims strings and accepts the supported contact and method types', async () => {
    const result = await validatePayload({ companyId: '31', contactType: ContactType.Person, name: '  María López  ', area: ' Compras ', position: ' Compradora ', notes: ' note ', methods: [{ type: ContactMethodType.Email, value: ' maria@example.test ' }, { type: ContactMethodType.Web, value: ' https://portal.example.test/login ' }] });
    expect(result.errors).toBe(0);
    expect(result.dto).toMatchObject({ name: 'María López', area: 'Compras', position: 'Compradora', notes: 'note', methods: [{ value: 'maria@example.test' }, { type: 'WEB', value: 'https://portal.example.test/login' }] });
  });

  it('rejects zero methods, OTRO, and invalid company identifiers', async () => {
    expect((await validatePayload({ companyId: '31', contactType: ContactType.Person, methods: [] })).errors).toBeGreaterThan(0);
    expect((await validatePayload({ companyId: '31', contactType: ContactType.Person, methods: [{ type: 'OTRO', value: 'x' }] })).errors).toBeGreaterThan(0);
    expect((await validatePayload({ companyId: '31.5', contactType: ContactType.Person, methods: [{ type: ContactMethodType.Email, value: 'x' }] })).errors).toBeGreaterThan(0);
  });
});
