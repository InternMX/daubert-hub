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
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ empresa_id: '121', tipo_empresa: 'PROVEEDOR', nombre_comercial: 'Acme', estatus: 'ACTIVO', observaciones: null }] })
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    const { repository, client } = repositoryWithClient(query);
    await expect(repository.create(input, 'request-1', { userId: null, userEmail: null })).resolves.toMatchObject({ company: { empresa_id: '121' }, fiscal: null });
    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(query).toHaveBeenNthCalledWith(2, "SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']);
    expect(query).toHaveBeenNthCalledWith(3, "SELECT set_config('app.request_id', $1, true)", ['request-1']);
    expect(query).toHaveBeenNthCalledWith(8, 'COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('inserts fiscal data before committing', async () => {
    const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ empresa_id: '121', tipo_empresa: 'SERVICIO', nombre_comercial: 'Acme', estatus: 'ACTIVO', observaciones: null }] })
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce({ rows: [{ empresa_fiscal_id: '122', razon_social: 'Acme SA', rfc: 'ABC123456XYZ' }] }).mockResolvedValueOnce(undefined);
    const { repository } = repositoryWithClient(query);
    await expect(repository.create({ ...input, providerType: ProviderType.Service, fiscal: { legalName: 'Acme SA', rfc: 'ABC123456XYZ' } }, 'request-2', { userId: null, userEmail: null })).resolves.toMatchObject({ fiscal: { empresa_fiscal_id: '122' } });
    expect(query).toHaveBeenNthCalledWith(9, 'COMMIT');
  });

  it('rolls back and releases the client when fiscal insertion fails', async () => {
    const duplicate = { code: '23505', constraint: 'uq_empresas_fiscales_rfc' };
    const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ empresa_id: '121', tipo_empresa: 'PROVEEDOR', nombre_comercial: 'Acme', estatus: 'ACTIVO', observaciones: null }] })
      .mockResolvedValueOnce(undefined).mockRejectedValueOnce(duplicate).mockResolvedValueOnce(undefined);
    const { repository, client } = repositoryWithClient(query);
    await expect(repository.create({ ...input, fiscal: { legalName: 'Acme SA', rfc: 'ABC123456XYZ' } }, 'request-3', { userId: null, userEmail: null })).rejects.toBe(duplicate);
    expect(query).toHaveBeenNthCalledWith(9, 'ROLLBACK');
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
    expect(query.mock.calls[0]?.[0]).toContain('SELECT role.rol, role.estatus');
    expect(query.mock.calls[0]?.[0]).not.toContain("AND role.estatus = 'ACTIVO'");
    expect(query.mock.calls[0]?.[0]).toContain("role.rol IN ('PROVEEDOR', 'SERVICIO', 'FLETE')");
    expect(query.mock.calls[0]?.[0]).toContain("provider_role.estatus = 'ACTIVO'");
    expect(query.mock.calls[0]?.[0]).toContain("provider_role.estatus = 'INACTIVO'");
    expect(query.mock.calls[0]?.[0]).toContain("company.estatus <> 'BLOQUEADO'");
    expect(query.mock.calls[1]?.[0]).toContain("CASE WHEN company.estatus = 'BLOQUEADO' THEN 'BLOQUEADO' ELSE provider_role.estatus END AS status");
    expect(query.mock.calls[0]?.[0]).toContain("FROM core.alias_empresa alias");
    expect(query.mock.calls[0]?.[0]).toContain("alias.estatus = 'ACTIVO'");
    expect(query.mock.calls[0]?.[0]).toContain('ORDER BY fecha_inicio DESC NULLS LAST, empresa_fiscal_id DESC');
    expect(query.mock.calls[1]?.[0]).toContain('ORDER BY lower(btrim(fiscal.razon_social)) DESC NULLS LAST, company.empresa_id');
  });

  it('finds one active provider with current fiscal data and all active provider roles', async () => {
    const query = vi.fn().mockResolvedValue([{ id: '9007199254740993', commercial_name: 'Acme', provider_type: 'PROVEEDOR', roles: ['PROVEEDOR', 'FLETE'], aliases: ['BMASC'], other_aliases: [{ alias: 'ACME FILE', type: 'NOMBRE_ARCHIVO' }], status: 'ACTIVO', notes: null, fiscal_id: '9007199254740994', legal_name: 'Acme SA', rfc: 'ABC123456XYZ' }]);
    const repository = new ProvidersRepository({ query } as never);
    await expect(repository.findById(121)).resolves.toMatchObject({ id: '9007199254740993', roles: ['PROVEEDOR', 'FLETE'], aliases: ['BMASC'], other_aliases: [{ alias: 'ACME FILE', type: 'NOMBRE_ARCHIVO' }] });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE company.empresa_id = $1'), [121]);
    expect(query.mock.calls[0]?.[0]).toContain("role.estatus = 'ACTIVO'");
    expect(query.mock.calls[0]?.[0]).toContain("role.rol IN ('PROVEEDOR', 'SERVICIO', 'FLETE')");
    expect(query.mock.calls[0]?.[0]).toContain("CASE WHEN company.estatus = 'BLOQUEADO' THEN 'BLOQUEADO' ELSE provider_role.estatus END AS status");
    expect(query.mock.calls[0]?.[0]).toContain('array_agg(role.rol ORDER BY CASE role.rol');
    expect(query.mock.calls[0]?.[0]).toContain("alias.tipo_alias = 'NOMBRE_COMERCIAL_ALTERNATIVO'");
    expect(query.mock.calls[0]?.[0]).toContain("alias.tipo_alias <> 'NOMBRE_COMERCIAL_ALTERNATIVO'");
    expect(query.mock.calls[0]?.[0]).toContain("alias.estatus = 'ACTIVO'");
    expect(query.mock.calls[0]?.[0]).toContain('ORDER BY fecha_inicio DESC NULLS LAST, empresa_fiscal_id DESC');
  });

  it('returns null when no active provider role matches the company', async () => {
    const repository = new ProvidersRepository({ query: vi.fn().mockResolvedValue([]) } as never);
    await expect(repository.findById(121)).resolves.toBeNull();
  });

  it('reconciles aliases inside the provider update transaction', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ empresa_id: '121', tipo_empresa: 'PROVEEDOR', nombre_comercial: 'Acme', observaciones: null, estatus: 'ACTIVO' }] })
      .mockResolvedValueOnce({ rows: [{ rol: 'PROVEEDOR' }] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ alias_id: '1', alias: 'BMASC' }, { alias_id: '2', alias: 'B ASC' }] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    const findById = vi.fn().mockResolvedValue([{ id: '121', commercial_name: 'Acme updated', provider_type: 'PROVEEDOR', roles: ['PROVEEDOR'], aliases: ['B+ASC', 'BMASC'], other_aliases: [], status: 'ACTIVO', notes: null, fiscal_id: null, legal_name: null, rfc: null }]);
    const client = { query, release: vi.fn() };
    const repository = new ProvidersRepository({ connect: vi.fn().mockResolvedValue(client), query: findById } as never);

    await repository.update(121, { commercialName: 'Acme updated', aliases: ['BMASC', 'B+ASC'] }, 'request-alias', { userId: null, userEmail: null });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM core.alias_empresa'), [121, ['2']]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO core.alias_empresa'), [121, 'B+ASC']);
    expect(query).toHaveBeenCalledWith('COMMIT');
  });

  it('rolls back the company update when an alias belongs to another company', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ empresa_id: '121', tipo_empresa: 'PROVEEDOR', nombre_comercial: 'Acme', observaciones: null, estatus: 'ACTIVO' }] })
      .mockResolvedValueOnce({ rows: [{ rol: 'PROVEEDOR' }] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ exists: 1 }] })
      .mockResolvedValueOnce(undefined);
    const client = { query, release: vi.fn() };
    const repository = new ProvidersRepository({ connect: vi.fn().mockResolvedValue(client) } as never);

    await expect(repository.update(121, { commercialName: 'Must roll back', aliases: ['TAKEN'] }, 'request-alias', { userId: null, userEmail: null })).rejects.toMatchObject({ code: 'ALIAS_ALREADY_ASSOCIATED' });
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query).not.toHaveBeenCalledWith('COMMIT');
  });

  describe('changeStatus (role-aware lifecycle)', () => {
    function repositoryForChangeStatus(query: ReturnType<typeof vi.fn>, findByIdResult: unknown[]) {
      const client = { query, release: vi.fn() };
      const findById = vi.fn().mockResolvedValue(findByIdResult);
      return { repository: new ProvidersRepository({ connect: vi.fn().mockResolvedValue(client), query: findById } as never), client, findById };
    }

    it('provider-only company: deactivating the provider role also deactivates the company (no other active role remains)', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ empresa_id: '121', tipo_empresa: 'PROVEEDOR', nombre_comercial: 'Acme', observaciones: null, estatus: 'ACTIVO' }] })
        .mockResolvedValueOnce({ rows: [{ rol: 'PROVEEDOR', estatus: 'ACTIVO' }] })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      const { repository } = repositoryForChangeStatus(query, [{ id: '121', status: 'INACTIVO' }]);

      await repository.changeStatus(121, 'INACTIVO', 'request-deactivate', { userId: '1', userEmail: 'a@daubertcromwell.com' });

      expect(query).toHaveBeenCalledWith("UPDATE core.empresa_roles SET estatus = $1 WHERE empresa_id = $2 AND rol = $3", ['INACTIVO', 121, 'PROVEEDOR']);
      expect(query).toHaveBeenCalledWith('UPDATE core.empresas SET estatus = $1 WHERE empresa_id = $2', ['INACTIVO', 121]);
      expect(query).toHaveBeenCalledWith('COMMIT');
    });

    it('provider + client company: deactivating the provider role leaves CLIENTE and the company ACTIVO', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ empresa_id: '121', tipo_empresa: 'PROVEEDOR', nombre_comercial: 'Acme', observaciones: null, estatus: 'ACTIVO' }] })
        .mockResolvedValueOnce({ rows: [{ rol: 'PROVEEDOR', estatus: 'ACTIVO' }, { rol: 'CLIENTE', estatus: 'ACTIVO' }] })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      const { repository } = repositoryForChangeStatus(query, [{ id: '121', status: 'ACTIVO' }]);

      await repository.changeStatus(121, 'INACTIVO', 'request-deactivate', { userId: '1', userEmail: 'a@daubertcromwell.com' });

      expect(query).toHaveBeenCalledWith("UPDATE core.empresa_roles SET estatus = $1 WHERE empresa_id = $2 AND rol = $3", ['INACTIVO', 121, 'PROVEEDOR']);
      // The company-level UPDATE must never run — CLIENTE is still active.
      expect(query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE core.empresas SET estatus'), expect.anything());
      expect(query).toHaveBeenCalledWith('COMMIT');
    });

    it('reactivation restores the provider role and, if needed, the company', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ empresa_id: '121', tipo_empresa: 'PROVEEDOR', nombre_comercial: 'Acme', observaciones: null, estatus: 'INACTIVO' }] })
        .mockResolvedValueOnce({ rows: [{ rol: 'PROVEEDOR', estatus: 'INACTIVO' }] })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      const { repository } = repositoryForChangeStatus(query, [{ id: '121', status: 'ACTIVO' }]);

      await repository.changeStatus(121, 'ACTIVO', 'request-reactivate', { userId: '1', userEmail: 'a@daubertcromwell.com' });

      expect(query).toHaveBeenCalledWith('UPDATE core.empresas SET estatus = $1 WHERE empresa_id = $2', ['ACTIVO', 121]);
      expect(query).toHaveBeenCalledWith("UPDATE core.empresa_roles SET estatus = $1 WHERE empresa_id = $2 AND rol = $3", ['ACTIVO', 121, 'PROVEEDOR']);
      expect(query).toHaveBeenCalledWith('COMMIT');
    });

    it('throws PROVIDER_ALREADY_INACTIVE when the provider role (not the company) is already inactive, and rolls back', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ empresa_id: '121', tipo_empresa: 'PROVEEDOR', nombre_comercial: 'Acme', observaciones: null, estatus: 'ACTIVO' }] })
        .mockResolvedValueOnce({ rows: [{ rol: 'PROVEEDOR', estatus: 'INACTIVO' }, { rol: 'CLIENTE', estatus: 'ACTIVO' }] })
        .mockResolvedValueOnce(undefined);
      const { repository } = repositoryForChangeStatus(query, []);

      await expect(repository.changeStatus(121, 'INACTIVO', 'request-deactivate', { userId: '1', userEmail: 'a@daubertcromwell.com' })).rejects.toMatchObject({ code: 'PROVIDER_ALREADY_INACTIVE' });
      expect(query).toHaveBeenCalledWith('ROLLBACK');
      expect(query).not.toHaveBeenCalledWith('COMMIT');
    });

    it('returns null when the company has no provider-type role at all (never a provider)', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ empresa_id: '121', tipo_empresa: 'CLIENTE', nombre_comercial: 'Acme', observaciones: null, estatus: 'ACTIVO' }] })
        .mockResolvedValueOnce({ rows: [{ rol: 'CLIENTE', estatus: 'ACTIVO' }] })
        .mockResolvedValueOnce(undefined);
      const { repository } = repositoryForChangeStatus(query, []);

      await expect(repository.changeStatus(121, 'INACTIVO', 'request-deactivate', { userId: '1', userEmail: 'a@daubertcromwell.com' })).resolves.toBeNull();
      expect(query).toHaveBeenCalledWith('COMMIT');
    });
  });
});
