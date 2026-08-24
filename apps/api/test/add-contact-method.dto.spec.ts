import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { AddContactMethodDto } from '../src/contact-methods/dto/add-contact-method.dto';

async function validatePayload(payload: object): Promise<{ dto: AddContactMethodDto; errors: number }> {
  const dto = plainToInstance(AddContactMethodDto, payload);
  return { dto, errors: (await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length };
}

describe('AddContactMethodDto', () => {
  it.each(['CORREO', 'TELEFONO', 'WHATSAPP'])('trims and accepts %s', async (type) => {
    const result = await validatePayload({ type, value: '  method value  ' });
    expect(result.errors).toBe(0);
    expect(result.dto.value).toBe('method value');
  });

  it.each(['OTRO', 'SMS'])('rejects unsupported type %s', async (type) => {
    expect((await validatePayload({ type, value: 'method value' })).errors).toBeGreaterThan(0);
  });

  it('rejects fields outside the creation contract', async () => {
    expect((await validatePayload({ type: 'CORREO', value: 'safe@example.test', status: 'ACTIVO' })).errors).toBeGreaterThan(0);
  });
});
