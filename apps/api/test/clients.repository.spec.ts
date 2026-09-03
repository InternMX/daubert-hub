import { describe, expect, it, vi } from 'vitest';
import { ClientsRepository, type ClientRow } from '../src/clients/clients.repository';

const identity = { userId: null, userEmail: null };
const detail: ClientRow = {
  id: '9007199254740993', commercial_name: 'Acme', company_type: 'CLIENTE', status: 'ACTIVO', client_status: 'ACTIVO', notes: null,
  fiscal_id: null, legal_name: null, rfc: null, fiscal_start_date: null, fiscal_end_date: null, roles: ['CLIENTE']
};

function harness(handler: (sql: string, values?: unknown[]) => unknown) {
  const query = vi.fn(async (sql: string, values?: unknown[]) => handler(sql, values));
  const client = { query, release: vi.fn() };
  return { repository: new ClientsRepository({ connect: vi.fn().mockResolvedValue(client) } as never), query, client };
}

function result(rows: unknown[] = []) { return { rows }; }

describe('ClientsRepository', () => {
  it('lists any company with a CLIENTE role regardless of role or company status, with current fiscal data', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ total: '1' }]).mockResolvedValueOnce([detail]);
    const repository = new ClientsRepository({ query } as never);
    await expect(repository.list({ page: 1, pageSize: 25, sortOrder: 'asc' } as never)).resolves.toEqual({ total: 1, clients: [detail] });
    expect(query.mock.calls[0]?.[0]).toContain("cliente_role.rol = 'CLIENTE'");
    expect(query.mock.calls[0]?.[0]).not.toContain("company.estatus = 'ACTIVO'");
    expect(query.mock.calls[0]?.[0]).not.toContain("'CLIENTE' = ANY(roles.roles)");
    expect(query.mock.calls[0]?.[0]).toContain('es_vigente = TRUE');
    expect(query.mock.calls[1]?.[0]).toContain('cliente_role.estatus AS client_status');
  });

  it('findClientById returns an inactive-CLIENTE row without requiring an active role or company', async () => {
    const inactiveClient: ClientRow = { ...detail, status: 'INACTIVO', client_status: 'INACTIVO', roles: [] };
    const query = vi.fn().mockResolvedValueOnce([inactiveClient]);
    const repository = new ClientsRepository({ query } as never);
    await expect(repository.findClientById(detail.id)).resolves.toEqual(inactiveClient);
    expect(query.mock.calls[0]?.[0]).toContain("cliente_role.rol = 'CLIENTE'");
    expect(query.mock.calls[0]?.[0]).not.toContain("company.estatus = 'ACTIVO'");
    expect(query.mock.calls[0]?.[0]).not.toContain("'CLIENTE' = ANY(roles.roles)");
  });

  it('findClientById returns null for a company with no CLIENTE role at all', async () => {
    const query = vi.fn().mockResolvedValueOnce([]);
    const repository = new ClientsRepository({ query } as never);
    await expect(repository.findClientById('999')).resolves.toBeNull();
  });

  it('creates company, CLIENTE role, and fiscal in one audited transaction', async () => {
    const { repository, query, client } = harness((sql) => {
      if (sql.includes('WHERE lower(btrim(nombre_comercial))')) return result();
      if (sql.includes('JOIN core.empresas_fiscales')) return result();
      if (sql.includes('INSERT INTO core.empresas (')) return result([{ empresa_id: detail.id }]);
      if (sql.includes('SELECT company.empresa_id::text AS id')) return result([{ ...detail, fiscal_id: '2', legal_name: 'Acme SA', rfc: 'ACM010101AA1' }]);
      return result();
    });
    await repository.create({ commercialName: 'Acme', fiscal: { legalName: 'Acme SA', rfc: 'ACM010101AA1' } }, 'request-1', identity);
    expect(query.mock.calls.slice(0, 5).map((call) => call[0])).toEqual([
      'BEGIN',
      "SELECT set_config('app.origin', $1, true)",
      "SELECT set_config('app.request_id', $1, true)",
      "SELECT set_config('app.user_id', COALESCE($1, ''), true)",
      "SELECT set_config('app.user_email', COALESCE($1, ''), true)"
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO core.empresa_roles'), [detail.id]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO core.empresas_fiscales'), [detail.id, 'Acme SA', 'ACM010101AA1']);
    expect(query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('creates without fiscal data and does not touch empresas_fiscales', async () => {
    const { repository, query } = harness((sql) => {
      if (sql.includes('WHERE lower(btrim(nombre_comercial))')) return result();
      if (sql.includes('INSERT INTO core.empresas (')) return result([{ empresa_id: detail.id }]);
      if (sql.includes('SELECT company.empresa_id::text AS id')) return result([detail]);
      return result();
    });
    await repository.create({ commercialName: 'Acme' }, 'request-1', identity);
    expect(query.mock.calls.some((call) => String(call[0]).startsWith('INSERT INTO core.empresas_fiscales'))).toBe(false);
  });

  it('rolls back company and role when fiscal insertion fails', async () => {
    const failure = { code: '23505', constraint: 'uq_empresas_fiscales_rfc' };
    const { repository, query, client } = harness((sql) => {
      if (sql.includes('WHERE lower(btrim(nombre_comercial))') || sql.includes('JOIN core.empresas_fiscales')) return result();
      if (sql.includes('INSERT INTO core.empresas (')) return result([{ empresa_id: detail.id }]);
      if (sql.startsWith('INSERT INTO core.empresas_fiscales')) throw failure;
      return result();
    });
    await expect(repository.create({ commercialName: 'Acme', fiscal: { legalName: 'Acme SA', rfc: 'ACM010101AA1' } }, 'request-1', identity)).rejects.toBe(failure);
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('reuses an unambiguous company, preserves other roles/fiscal, and reactivates CLIENTE', async () => {
    const company = { empresa_id: detail.id, tipo_empresa: 'PROVEEDOR', nombre_comercial: 'Acme', estatus: 'ACTIVO', observaciones: null };
    const { repository, query } = harness((sql) => {
      if (sql.includes('WHERE lower(btrim(nombre_comercial))')) return result([company]);
      if (sql.startsWith('SELECT rol, estatus')) return result([{ rol: 'PROVEEDOR', estatus: 'ACTIVO' }, { rol: 'CLIENTE', estatus: 'INACTIVO' }]);
      if (sql.includes('SELECT company.empresa_id::text AS id')) return result([{ ...detail, company_type: 'PROVEEDOR', roles: ['PROVEEDOR', 'CLIENTE'] }]);
      if (sql.includes('FROM core.empresas_fiscales WHERE')) return result([{ empresa_fiscal_id: '2', razon_social: 'Acme SA', rfc: 'ACM010101AA1' }]);
      return result();
    });
    const created = await repository.create({ commercialName: ' acme ' }, 'request-2', identity);
    expect(created.id).toBe(detail.id);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (empresa_id, rol)'), [detail.id]);
    expect(query.mock.calls.some((call) => String(call[0]).startsWith('INSERT INTO core.empresas ('))).toBe(false);
    expect(query.mock.calls.some((call) => String(call[0]).startsWith('UPDATE core.empresas_fiscales'))).toBe(false);
  });

  it('inserts a first fiscal identity when reusing a company that currently has none (B2)', async () => {
    const company = { empresa_id: detail.id, tipo_empresa: 'SERVICIO', nombre_comercial: 'Acme', estatus: 'ACTIVO', observaciones: null };
    const { repository, query } = harness((sql) => {
      if (sql.includes('WHERE lower(btrim(nombre_comercial))')) return result([company]);
      if (sql.includes('JOIN core.empresas_fiscales')) return result();
      if (sql.startsWith('SELECT rol, estatus')) return result([{ rol: 'SERVICIO', estatus: 'ACTIVO' }]);
      if (sql.includes('SELECT company.empresa_id::text AS id')) return result([{ ...detail, company_type: 'SERVICIO', fiscal_id: '9', legal_name: 'Acme SA', rfc: 'ACM010101AA1', roles: ['SERVICIO', 'CLIENTE'] }]);
      if (sql.includes('FROM core.empresas_fiscales WHERE')) return result();
      return result();
    });
    const created = await repository.create({ commercialName: 'Acme', fiscal: { legalName: 'Acme SA', rfc: 'ACM010101AA1' } }, 'request-8', identity);
    expect(created.id).toBe(detail.id);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO core.empresas_fiscales'), [detail.id, 'Acme SA', 'ACM010101AA1']);
    expect(query.mock.calls.some((call) => String(call[0]).startsWith('INSERT INTO core.empresas ('))).toBe(false);
  });

  it('treats a lower-case stored RFC as matching on create reuse (B1)', async () => {
    const company = { empresa_id: detail.id, tipo_empresa: 'PROVEEDOR', nombre_comercial: 'Acme', estatus: 'ACTIVO', observaciones: null };
    const { repository, query } = harness((sql) => {
      if (sql.includes('WHERE lower(btrim(nombre_comercial))')) return result([company]);
      if (sql.includes('JOIN core.empresas_fiscales')) return result([company]);
      if (sql.startsWith('SELECT rol, estatus')) return result([{ rol: 'PROVEEDOR', estatus: 'ACTIVO' }]);
      if (sql.includes('SELECT company.empresa_id::text AS id')) return result([{ ...detail, company_type: 'PROVEEDOR', fiscal_id: '2', legal_name: 'Acme SA', rfc: 'acm010101aa1', roles: ['PROVEEDOR', 'CLIENTE'] }]);
      if (sql.includes('FROM core.empresas_fiscales WHERE')) return result([{ empresa_fiscal_id: '2', razon_social: 'Acme SA', rfc: 'acm010101aa1' }]);
      return result();
    });
    await expect(repository.create({ commercialName: 'Acme', fiscal: { legalName: 'Acme SA', rfc: 'ACM010101AA1' } }, 'request-9', identity)).resolves.toMatchObject({ id: detail.id });
    expect(query.mock.calls.some((call) => String(call[0]).startsWith('INSERT INTO core.empresas_fiscales'))).toBe(false);
  });

  it.each([
    ['active CLIENTE', { roles: [{ rol: 'CLIENTE', estatus: 'ACTIVO' }], fiscal: null }, 'CLIENT_ALREADY_ACTIVE'],
    ['conflicting RFC', { roles: [{ rol: 'PROVEEDOR', estatus: 'ACTIVO' }], fiscal: { empresa_fiscal_id: '2', razon_social: 'Acme SA', rfc: 'OLD010101AA1' } }, 'CLIENT_NAME_RFC_CONFLICT']
  ])('rejects %s without modifications', async (_label, state, code) => {
    const { repository, query } = harness((sql) => {
      if (sql.includes('WHERE lower(btrim(nombre_comercial))')) return result([{ empresa_id: detail.id, estatus: 'ACTIVO' }]);
      if (sql.includes('JOIN core.empresas_fiscales')) return result([{ empresa_id: detail.id }]);
      if (sql.startsWith('SELECT rol, estatus')) return result(state.roles);
      if (sql.includes('FROM core.empresas_fiscales WHERE')) return result(state.fiscal ? [state.fiscal] : []);
      return result();
    });
    await expect(repository.create({ commercialName: 'Acme', fiscal: { legalName: 'Acme SA', rfc: 'NEW010101AA1' } }, 'request-3', identity)).rejects.toMatchObject({ code });
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query.mock.calls.some((call) => /^(INSERT|UPDATE|DELETE) /.test(String(call[0])))).toBe(false);
  });

  it('deactivates only CLIENTE when another role is active', async () => {
    const { repository, query } = harness((sql) => {
      if (sql.includes('FROM core.empresas WHERE empresa_id')) return result([{ empresa_id: detail.id, estatus: 'ACTIVO' }]);
      if (sql.startsWith('SELECT rol, estatus')) return result([{ rol: 'CLIENTE', estatus: 'ACTIVO' }, { rol: 'PROVEEDOR', estatus: 'ACTIVO' }]);
      if (sql.includes('SELECT company.empresa_id::text AS id')) return result([{ ...detail, roles: ['PROVEEDOR'] }]);
      return result();
    });
    await repository.changeStatus(detail.id, 'INACTIVO', 'request-4', identity);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SET estatus = 'INACTIVO' WHERE empresa_id = $1 AND rol = 'CLIENTE'"), [detail.id]);
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("UPDATE core.empresas SET estatus = 'INACTIVO'"), expect.anything());
  });

  it('inactivates the company when CLIENTE is its final active role', async () => {
    const { repository, query } = harness((sql) => {
      if (sql.includes('FROM core.empresas WHERE empresa_id')) return result([{ empresa_id: detail.id, estatus: 'ACTIVO' }]);
      if (sql.startsWith('SELECT rol, estatus')) return result([{ rol: 'CLIENTE', estatus: 'ACTIVO' }, { rol: 'PROVEEDOR', estatus: 'INACTIVO' }]);
      if (sql.includes('SELECT company.empresa_id::text AS id')) return result([{ ...detail, status: 'INACTIVO', roles: [] }]);
      return result();
    });
    await repository.changeStatus(detail.id, 'INACTIVO', 'request-5', identity);
    expect(query).toHaveBeenCalledWith("UPDATE core.empresas SET estatus = 'INACTIVO' WHERE empresa_id = $1", [detail.id]);
  });

  it('reactivates an inactive company and its existing CLIENTE role', async () => {
    const { repository, query } = harness((sql) => {
      if (sql.includes('FROM core.empresas WHERE empresa_id')) return result([{ empresa_id: detail.id, estatus: 'INACTIVO' }]);
      if (sql.startsWith('SELECT rol, estatus')) return result([{ rol: 'CLIENTE', estatus: 'INACTIVO' }]);
      if (sql.includes('SELECT company.empresa_id::text AS id')) return result([detail]);
      return result();
    });
    await repository.changeStatus(detail.id, 'ACTIVO', 'request-6', identity);
    expect(query).toHaveBeenCalledWith("UPDATE core.empresas SET estatus = 'ACTIVO' WHERE empresa_id = $1", [detail.id]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (empresa_id, rol)'), [detail.id]);
  });

  it('preserves fiscal history during NEW_IDENTITY update', async () => {
    const { repository, query } = harness((sql) => {
      if (sql.includes('FROM core.empresas WHERE empresa_id')) return result([{ empresa_id: detail.id, estatus: 'ACTIVO' }]);
      if (sql.startsWith('SELECT rol, estatus')) return result([{ rol: 'CLIENTE', estatus: 'ACTIVO' }]);
      if (sql.includes('FROM core.empresas_fiscales WHERE')) return result([{ empresa_fiscal_id: '2', razon_social: 'Old SA', rfc: 'OLD010101AA1' }]);
      if (sql.includes('SELECT company.empresa_id::text AS id')) return result([{ ...detail, fiscal_id: '3', legal_name: 'New SA', rfc: 'NEW010101AA1' }]);
      return result();
    });
    await repository.update(detail.id, { fiscal: { legalName: 'New SA', rfc: 'NEW010101AA1', changeMode: 'NEW_IDENTITY' as never, effectiveStartDate: '2026-09-03' } }, 'request-7', identity);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('SET es_vigente = FALSE, fecha_fin = $1'), ['2026-09-03', '2']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('es_vigente, fecha_inicio'), [detail.id, 'New SA', 'NEW010101AA1', '2026-09-03']);
    expect(query).toHaveBeenCalledWith('COMMIT');
  });

  it('treats a lower-case stored RFC as unchanged on PATCH and only renames the fiscal identity (B4)', async () => {
    const { repository, query } = harness((sql) => {
      if (sql.includes('FROM core.empresas WHERE empresa_id')) return result([{ empresa_id: detail.id, estatus: 'ACTIVO' }]);
      if (sql.startsWith('SELECT rol, estatus')) return result([{ rol: 'CLIENTE', estatus: 'ACTIVO' }]);
      if (sql.includes('FROM core.empresas_fiscales WHERE')) return result([{ empresa_fiscal_id: '2', razon_social: 'Old SA', rfc: 'acm010101aa1' }]);
      if (sql.includes('SELECT company.empresa_id::text AS id')) return result([{ ...detail, fiscal_id: '2', legal_name: 'New SA', rfc: 'acm010101aa1' }]);
      return result();
    });
    await repository.update(detail.id, { fiscal: { legalName: 'New SA', rfc: 'ACM010101AA1' } }, 'request-10', identity);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE core.empresas_fiscales SET razon_social'), ['New SA', '2']);
    expect(query.mock.calls.some((call) => String(call[0]).startsWith('INSERT INTO core.empresas_fiscales'))).toBe(false);
    expect(query).toHaveBeenCalledWith('COMMIT');
  });

  it('refuses a half-pair fiscal PATCH at the repository layer as defence in depth (FISCAL_INCOMPLETE)', async () => {
    const { repository, query } = harness((sql) => {
      if (sql.includes('FROM core.empresas WHERE empresa_id')) return result([{ empresa_id: detail.id, estatus: 'ACTIVO' }]);
      if (sql.startsWith('SELECT rol, estatus')) return result([{ rol: 'CLIENTE', estatus: 'ACTIVO' }]);
      if (sql.includes('FROM core.empresas_fiscales WHERE')) return result([{ empresa_fiscal_id: '2', razon_social: 'Old SA', rfc: 'OLD010101AA1' }]);
      return result();
    });
    await expect(repository.update(detail.id, { fiscal: { legalName: 'Only Name' } } as never, 'request-11', identity)).rejects.toMatchObject({ code: 'FISCAL_INCOMPLETE' });
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query.mock.calls.some((call) => /^(INSERT|UPDATE|DELETE) /.test(String(call[0])))).toBe(false);
  });
});
