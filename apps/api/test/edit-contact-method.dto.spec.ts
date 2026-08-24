import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { EditContactMethodDto } from '../src/contact-methods/dto/edit-contact-method.dto';

async function validatePayload(payload: object): Promise<{ dto: EditContactMethodDto; errors: number }> {
  const dto = plainToInstance(EditContactMethodDto, payload);
  return { dto, errors: (await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length };
}

describe('EditContactMethodDto', () => {
  it.each([{ value: '  corrected@example.test  ' }, { type: 'TELEFONO' }, { type: 'WHATSAPP', value: '  +52 449 555 0200  ' }])('accepts and trims partial payload %#', async (payload) => {
    const result = await validatePayload(payload);
    expect(result.errors).toBe(0);
    if (typeof payload.value === 'string') expect(result.dto.value).toBe(payload.value.trim());
  });

  it.each(['OTRO', 'SMS'])('rejects unsupported target type %s', async (type) => {
    expect((await validatePayload({ type })).errors).toBeGreaterThan(0);
  });

  it.each([{ type: null }, { value: null }, { value: 4491234567 }])('rejects invalid supplied field %#', async (payload) => {
    expect((await validatePayload(payload)).errors).toBeGreaterThan(0);
  });

  it.each(['contactId', 'status', 'isPrimary', 'recibe_notificacion_pago', 'tipo_destinatario_pago', 'observations'])('rejects non-editable field %s', async (field) => {
    expect((await validatePayload({ value: 'safe@example.test', [field]: 'unsafe' })).errors).toBeGreaterThan(0);
  });
});
