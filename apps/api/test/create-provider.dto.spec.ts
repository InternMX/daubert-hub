import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateProviderDto, ProviderType } from '../src/providers/dto/create-provider.dto';

async function validatePayload(payload: object): Promise<{ dto: CreateProviderDto; errors: number }> {
  const dto = plainToInstance(CreateProviderDto, payload);
  return { dto, errors: (await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length };
}

describe('CreateProviderDto', () => {
  it.each(Object.values(ProviderType))('accepts provider type %s', async (providerType) => {
    const result = await validatePayload({ commercialName: '  Acme  ', providerType, notes: '  note  ' });
    expect(result.errors).toBe(0);
    expect(result.dto.commercialName).toBe('Acme');
    expect(result.dto.notes).toBe('note');
  });

  it.each(['CLIENTE', 'OTRO', 'OTHER'])('rejects provider type %s', async (providerType) => {
    expect((await validatePayload({ commercialName: 'Acme', providerType })).errors).toBeGreaterThan(0);
  });

  it('rejects an empty name and partial fiscal information', async () => {
    expect((await validatePayload({ commercialName: '  ', providerType: ProviderType.Provider })).errors).toBeGreaterThan(0);
    expect((await validatePayload({ commercialName: 'Acme', providerType: ProviderType.Provider, fiscal: { legalName: 'Acme SA' } })).errors).toBeGreaterThan(0);
  });

  it('normalizes valid fiscal data and accepts omitted fiscal and null notes', async () => {
    const result = await validatePayload({ commercialName: 'Acme', providerType: ProviderType.Freight, fiscal: { legalName: '  Acme SA  ', rfc: ' abc123456xyz ' }, notes: '   ' });
    expect(result.errors).toBe(0);
    expect(result.dto.fiscal).toEqual({ legalName: 'Acme SA', rfc: 'ABC123456XYZ' });
    expect(result.dto.notes).toBeNull();
    expect((await validatePayload({ commercialName: 'Acme', providerType: ProviderType.Service, fiscal: null, notes: null })).errors).toBe(0);
  });

  it.each(['ABC 123456XYZ', 'ABC123456X', 'ABC123456XYZ12'])('rejects malformed RFC %s', async (rfc) => {
    expect((await validatePayload({ commercialName: 'Acme', providerType: ProviderType.Provider, fiscal: { legalName: 'Acme SA', rfc } })).errors).toBeGreaterThan(0);
  });
});
