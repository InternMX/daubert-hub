import { describe, expect, it, vi } from 'vitest';
import { ProviderType, type CreateProviderDto } from '../src/providers/dto/create-provider.dto';
import { ProviderSortBy, SortOrder } from '../src/providers/dto/list-providers.dto';
import { ProvidersRepository } from '../src/providers/providers.repository';

function repositoryWithClient(query: ReturnType<typeof vi.fn>) {
  const client = { query, release: vi.fn() };
  return { repository: new ProvidersRepository({ connect: vi.fn().mockResolvedValue(client) } as never), client };
}

const input: CreateProviderDto = { commercialName: 'Acme', providerType: ProviderType.Provider, notes: null };

describe('ProvidersRepository', () => {
  it('writes company and role in one transaction without fiscal data', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ empresa_id: '121', tipo_empresa: 'PROVEEDOR', nombre_comercial: 'Acme', estatus: 'ACTIVO', observaciones: null }] })
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    const { repository, client } = repositoryWithClient(query);
    await expect(repository.create(input, 'request-1')).resolves.toMatchObject({ company: { empresa_id: '121' }, fiscal: null });
    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(query).toHaveBeenNthCalledWith(2, "SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']);
    expect(query).toHaveBeenNthCalledWith(3, "SELECT set_config('app.request_id', $1, true)", ['request-1']);
    expect(query).toHaveBeenNthCalledWith(6, 'COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('inserts fiscal data before committing', async () => {
    const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ empresa_id: '121', tipo_empresa: 'SERVICIO', nombre_comercial: 'Acme', estatus: 'ACTIVO', observaciones: null }] })
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce({ rows: [{ empresa_fiscal_id: '122', razon_social: 'Acme SA', rfc: 'ABC123456XYZ' }] }).mockResolvedValueOnce(undefined);
    const { repository } = repositoryWithClient(query);
    await expect(repository.create({ ...input, providerType: ProviderType.Service, fiscal: { legalName: 'Acme SA', rfc: 'ABC123456XYZ' } }, 'request-2')).resolves.toMatchObject({ fiscal: { empresa_fiscal_id: '122' } });
    expect(query).toHaveBeenNthCalledWith(7, 'COMMIT');
  });

  it('rolls back and releases the client when fiscal insertion fails', async () => {
    const duplicate = { code: '23505', constraint: 'uq_empresas_fiscales_rfc' };
    const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ empresa_id: '121', tipo_empresa: 'PROVEEDOR', nombre_comercial: 'Acme', estatus: 'ACTIVO', observaciones: null }] })
      .mockResolvedValueOnce(undefined).mockRejectedValueOnce(duplicate).mockResolvedValueOnce(undefined);
    const { repository, client } = repositoryWithClient(query);
    await expect(repository.create({ ...input, fiscal: { legalName: 'Acme SA', rfc: 'ABC123456XYZ' } }, 'request-3')).rejects.toBe(duplicate);
    expect(query).toHaveBeenNthCalledWith(7, 'ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('counts and pages deduplicated active provider roles with parameterized search', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ total: '1' }])
      .mockResolvedValueOnce([{ id: '9007199254740993', commercial_name: 'Acme', provider_type: 'PROVEEDOR', status: 'ACTIVO', notes: null, fiscal_id: null, legal_name: null, rfc: null }]);
    const repository = new ProvidersRepository({ query } as never);
    await expect(repository.list({ providerType: ProviderType.Provider, search: 'Acme', page: 2, pageSize: 10, sortBy: ProviderSortBy.LegalName, sortOrder: SortOrder.Desc })).resolves.toEqual({
      total: 1,
      providers: [{ id: '9007199254740993', commercial_name: 'Acme', provider_type: 'PROVEEDOR', status: 'ACTIVO', notes: null, fiscal_id: null, legal_name: null, rfc: null }]
    });
    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('FROM core.empresas company'), ['PROVEEDOR', 'Acme', 'ACTIVO']);
    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('ORDER BY lower(btrim(fiscal.razon_social)) DESC NULLS LAST, company.empresa_id'), ['PROVEEDOR', 'Acme', 'ACTIVO', 10, 10]);
    expect(query.mock.calls[0]?.[0]).toContain("role.estatus = 'ACTIVO'");
    expect(query.mock.calls[0]?.[0]).toContain("role.rol IN ('PROVEEDOR', 'SERVICIO', 'FLETE')");
    expect(query.mock.calls[0]?.[0]).toContain("company.estatus = 'INACTIVO'");
    expect(query.mock.calls[0]?.[0]).toContain("FROM core.alias_empresa alias");
    expect(query.mock.calls[0]?.[0]).toContain("alias.estatus = 'ACTIVO'");
    expect(query.mock.calls[0]?.[0]).toContain('ORDER BY fecha_inicio DESC NULLS LAST, empresa_fiscal_id DESC');
    expect(query.mock.calls[1]?.[0]).toContain('ORDER BY lower(btrim(fiscal.razon_social)) DESC NULLS LAST, company.empresa_id');
  });

  it('finds one active provider with current fiscal data and all active provider roles', async () => {
    const query = vi.fn().mockResolvedValue([{ id: '9007199254740993', commercial_name: 'Acme', provider_type: 'PROVEEDOR', roles: ['PROVEEDOR', 'FLETE'], status: 'ACTIVO', notes: null, fiscal_id: '9007199254740994', legal_name: 'Acme SA', rfc: 'ABC123456XYZ' }]);
    const repository = new ProvidersRepository({ query } as never);
    await expect(repository.findById(121)).resolves.toMatchObject({ id: '9007199254740993', roles: ['PROVEEDOR', 'FLETE'] });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE company.empresa_id = $1'), [121]);
    expect(query.mock.calls[0]?.[0]).toContain("role.estatus = 'ACTIVO'");
    expect(query.mock.calls[0]?.[0]).toContain("role.rol IN ('PROVEEDOR', 'SERVICIO', 'FLETE')");
    expect(query.mock.calls[0]?.[0]).toContain('array_agg(role.rol ORDER BY CASE role.rol');
    expect(query.mock.calls[0]?.[0]).toContain('ORDER BY fecha_inicio DESC NULLS LAST, empresa_fiscal_id DESC');
  });

  it('returns null when no active provider role matches the company', async () => {
    const repository = new ProvidersRepository({ query: vi.fn().mockResolvedValue([]) } as never);
    await expect(repository.findById(121)).resolves.toBeNull();
  });
});
