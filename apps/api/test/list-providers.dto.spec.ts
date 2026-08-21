import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ListProvidersDto } from '../src/providers/dto/list-providers.dto';

async function validateQuery(query: object): Promise<{ dto: ListProvidersDto; errors: number }> {
  const dto = plainToInstance(ListProvidersDto, query);
  return { dto, errors: (await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length };
}

describe('ListProvidersDto', () => {
  it('defaults pagination, sorting, and trims search', async () => {
    const result = await validateQuery({ search: '  Acme  ' });
    expect(result.errors).toBe(0);
    expect(result.dto).toMatchObject({ search: 'Acme', status: 'ACTIVO', page: 1, pageSize: 25, sortBy: 'commercialName', sortOrder: 'asc' });
  });

  it('accepts provider filters and sorting and rejects invalid values', async () => {
    expect((await validateQuery({ providerType: 'FLETE', page: '2', pageSize: '100', sortBy: 'legalName', sortOrder: 'desc' })).errors).toBe(0);
    expect((await validateQuery({ providerType: 'CLIENTE' })).errors).toBeGreaterThan(0);
    expect((await validateQuery({ status: 'INACTIVO' })).errors).toBe(0);
    expect((await validateQuery({ status: 'ALL' })).errors).toBe(0);
    expect((await validateQuery({ status: 'BLOQUEADO' })).errors).toBeGreaterThan(0);
    expect((await validateQuery({ page: '0' })).errors).toBeGreaterThan(0);
    expect((await validateQuery({ pageSize: '101' })).errors).toBeGreaterThan(0);
    expect((await validateQuery({ sortBy: 'rfc' })).errors).toBeGreaterThan(0);
    expect((await validateQuery({ sortBy: 'status' })).errors).toBeGreaterThan(0);
    expect((await validateQuery({ sortBy: 'random' })).errors).toBeGreaterThan(0);
    expect((await validateQuery({ sortOrder: 'up' })).errors).toBeGreaterThan(0);
  });
});
