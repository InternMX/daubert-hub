import { describe, expect, it, vi } from 'vitest';
import { ProviderType, type CreateProviderDto } from '../src/providers/dto/create-provider.dto';
import { FiscalChangeMode, type UpdateProviderDto } from '../src/providers/dto/update-provider.dto';
import { ProviderSortBy, SortOrder, type ListProvidersDto } from '../src/providers/dto/list-providers.dto';
import { ProvidersService } from '../src/providers/providers.service';

const input: CreateProviderDto = { commercialName: 'Acme', providerType: ProviderType.Provider, notes: null };

describe('ProvidersService', () => {
  it('passes normalized input and maps a provider without fiscal data', async () => {
    const create = vi.fn().mockResolvedValue({ company: { empresa_id: '9007199254740993', tipo_empresa: 'PROVEEDOR', nombre_comercial: 'Acme', estatus: 'ACTIVO', observaciones: null }, fiscal: null });
    const service = new ProvidersService({ create } as never);
    await expect(service.create(input, 'request-1')).resolves.toEqual({ data: { id: '9007199254740993', commercialName: 'Acme', providerType: 'PROVEEDOR', status: 'ACTIVO', notes: null, fiscal: null } });
    expect(create).toHaveBeenCalledWith(input, 'request-1');
  });

  it('maps fiscal data without converting bigint identifiers to numbers', async () => {
    const service = new ProvidersService({ create: vi.fn().mockResolvedValue({ company: { empresa_id: '121', tipo_empresa: 'FLETE', nombre_comercial: 'Acme Freight', estatus: 'ACTIVO', observaciones: 'note' }, fiscal: { empresa_fiscal_id: '122', razon_social: 'Acme SA', rfc: 'ABC123456XYZ' } }) } as never);
    await expect(service.create({ ...input, providerType: ProviderType.Freight }, 'request-2')).resolves.toMatchObject({ data: { id: '121', fiscal: { id: '122', rfc: 'ABC123456XYZ' } } });
  });

  it.each([
    ['uq_empresas_nombre_comercial', 'PROVIDER_NAME_ALREADY_EXISTS'],
    ['uq_empresas_fiscales_rfc', 'RFC_ALREADY_EXISTS']
  ])('maps %s to conflict %s', async (constraint, code) => {
    const service = new ProvidersService({ create: vi.fn().mockRejectedValue({ code: '23505', constraint }) } as never);
    await expect(service.create(input, 'request-3')).rejects.toMatchObject({ response: { code } });
  });

  it('preserves unknown repository failures', async () => {
    const failure = new Error('connection refused');
    const service = new ProvidersService({ create: vi.fn().mockRejectedValue(failure) } as never);
    await expect(service.create(input, 'request-4')).rejects.toBe(failure);
  });

  it('maps listed providers and preserves bigint identifiers as strings', async () => {
    const list = vi.fn().mockResolvedValue({
      total: 1,
      providers: [{ id: '9007199254740993', commercial_name: 'Acme', provider_type: 'PROVEEDOR', status: 'ACTIVO', notes: null, fiscal_id: '9007199254740994', legal_name: 'Acme SA', rfc: 'ABC123456XYZ' }]
    });
    const input: ListProvidersDto = { page: 2, pageSize: 10, search: 'Acme', sortBy: ProviderSortBy.CommercialName, sortOrder: SortOrder.Asc };
    const service = new ProvidersService({ list } as never);
    await expect(service.list(input)).resolves.toEqual({
      data: [{ id: '9007199254740993', commercialName: 'Acme', providerType: 'PROVEEDOR', status: 'ACTIVO', notes: null, fiscal: { id: '9007199254740994', legalName: 'Acme SA', rfc: 'ABC123456XYZ' } }],
      meta: { page: 2, pageSize: 10, total: 1, totalPages: 1 }
    });
    expect(list).toHaveBeenCalledWith(input);
  });

  it('maps provider detail with deterministic active roles and current fiscal data', async () => {
    const findById = vi.fn().mockResolvedValue({ id: '9007199254740993', commercial_name: 'Acme', provider_type: 'PROVEEDOR', roles: ['PROVEEDOR', 'FLETE'], status: 'ACTIVO', notes: null, fiscal_id: '9007199254740994', legal_name: 'Acme SA', rfc: 'ABC123456XYZ' });
    const service = new ProvidersService({ findById } as never);
    await expect(service.get(121)).resolves.toEqual({
      data: { id: '9007199254740993', commercialName: 'Acme', providerType: 'PROVEEDOR', roles: ['PROVEEDOR', 'FLETE'], status: 'ACTIVO', notes: null, fiscal: { id: '9007199254740994', legalName: 'Acme SA', rfc: 'ABC123456XYZ' } }
    });
    expect(findById).toHaveBeenCalledWith(121);
  });

  it('returns 404 when the requested company is not an active provider', async () => {
    const service = new ProvidersService({ findById: vi.fn().mockResolvedValue(null) } as never);
    await expect(service.get(121)).rejects.toMatchObject({ status: 404 });
  });

  it('updates through the repository and returns the detail representation', async () => {
    const update = vi.fn().mockResolvedValue({ id: '121', commercial_name: 'Acme updated', provider_type: 'FLETE', roles: ['FLETE'], status: 'ACTIVO', notes: null, fiscal_id: null, legal_name: null, rfc: null });
    const service = new ProvidersService({ update } as never);
    const updateInput: UpdateProviderDto = { commercialName: 'Acme updated', providerType: ProviderType.Freight, notes: null, fiscal: { legalName: '', rfc: '' } };
    await expect(service.update(121, updateInput, 'request-update')).resolves.toMatchObject({ data: { commercialName: 'Acme updated', providerType: 'FLETE' } });
    expect(update).toHaveBeenCalledWith(121, updateInput, 'request-update');
  });

  it('requires an effective date for a new fiscal identity', async () => {
    const service = new ProvidersService({ update: vi.fn() } as never);
    await expect(service.update(121, { fiscal: { legalName: 'Acme SA', rfc: 'ACM010101AA1', changeMode: FiscalChangeMode.NewIdentity } }, 'request-update')).rejects.toMatchObject({ status: 400 });
  });

  it('changes only the provider lifecycle status through the repository', async () => {
    const changeStatus = vi.fn().mockResolvedValue({ id: '121', commercial_name: 'Acme', provider_type: 'PROVEEDOR', roles: ['PROVEEDOR'], status: 'INACTIVO', notes: null, fiscal_id: null, legal_name: null, rfc: null });
    const service = new ProvidersService({ changeStatus } as never);
    await expect(service.deactivate(121, 'request-status')).resolves.toMatchObject({ data: { status: 'INACTIVO' } });
    expect(changeStatus).toHaveBeenCalledWith(121, 'INACTIVO', 'request-status');
  });

  it('maps lifecycle conflicts to safe 409 responses', async () => {
    const service = new ProvidersService({ changeStatus: vi.fn().mockRejectedValue({ code: 'PROVIDER_ALREADY_INACTIVE' }) } as never);
    await expect(service.deactivate(121, 'request-status')).rejects.toMatchObject({ status: 409, response: { code: 'PROVIDER_ALREADY_INACTIVE' } });
  });
});
