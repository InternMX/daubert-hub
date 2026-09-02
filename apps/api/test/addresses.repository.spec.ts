import { describe, expect, it, vi } from 'vitest';
import { AddressesRepository } from '../src/addresses/addresses.repository';
import { AddressType } from '../src/addresses/dto/create-address.dto';

function withClient(query: ReturnType<typeof vi.fn>) {
  const client = { query, release: vi.fn() };
  return { repository: new AddressesRepository({ connect: vi.fn().mockResolvedValue(client) } as never), client };
}

const address = { direccion_id: '9', empresa_id: '2', tipo_direccion: 'ENTREGA', calle: 'Reforma', numero_exterior: null, numero_interior: null, colonia: null, codigo_postal: null, municipio: null, estado: null, pais: 'México', direccion_completa: null, referencias: null, estatus: 'ACTIVA', es_principal: true, fecha_inicio: '2026-09-01', fecha_fin: null, company_status: 'ACTIVO' };

describe('AddressesRepository', () => {
  it('checks company existence and lists empresa-only rows in deterministic status/principal/date order', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ exists: true }]).mockResolvedValueOnce([]);
    const repository = new AddressesRepository({ query } as never);
    await expect(repository.list('9007199254740993')).resolves.toEqual([]);
    expect(query).toHaveBeenNthCalledWith(1, 'SELECT TRUE AS exists FROM core.empresas WHERE empresa_id = $1', ['9007199254740993']);
    expect(query.mock.calls[1]).toEqual([expect.stringMatching(/empresa_id = \$1 AND direccion\.empresa_fiscal_id IS NULL[\s\S]*estatus = 'ACTIVA'[\s\S]*es_principal DESC[\s\S]*fecha_inicio DESC NULLS LAST/), ['9007199254740993']]);
  });

  it('returns null for a missing company without reading addresses', async () => {
    const query = vi.fn().mockResolvedValueOnce([]);
    const repository = new AddressesRepository({ query } as never);
    await expect(repository.list('999')).resolves.toBeNull();
    expect(query).toHaveBeenCalledOnce();
  });

  it('creates a principal with omitted defaults, all audit context, and same company/type ACTIVA demotion', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ estatus: 'ACTIVO' }] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [address] }).mockResolvedValueOnce(undefined);
    const { repository, client } = withClient(query);
    await expect(repository.create('2', { tipoDireccion: AddressType.Delivery, calle: 'Reforma', esPrincipal: true }, 'request-1', { userId: null, userEmail: null })).resolves.toEqual(address);
    expect(query).toHaveBeenNthCalledWith(2, "SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']);
    expect(query).toHaveBeenNthCalledWith(3, "SELECT set_config('app.request_id', $1, true)", ['request-1']);
    expect(query).toHaveBeenNthCalledWith(4, "SELECT set_config('app.user_id', COALESCE($1, ''), true)", [null]);
    expect(query).toHaveBeenNthCalledWith(5, "SELECT set_config('app.user_email', COALESCE($1, ''), true)", [null]);
    expect(query.mock.calls[6]).toEqual([expect.stringMatching(/empresa_fiscal_id IS NULL[\s\S]*tipo_direccion = \$2[\s\S]*estatus = 'ACTIVA'/), ['2', 'ENTREGA', null]]);
    const insert = String(query.mock.calls[7]?.[0]).split('RETURNING')[0];
    expect(insert).not.toMatch(/pais|fecha_inicio|fecha_fin|estatus/);
    expect(query).toHaveBeenLastCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it.each([
    [{ calle: null }, 'ADDRESS_CONTENT_REQUIRED'],
    [{ fechaInicio: '2026-10-01' }, 'ADDRESS_DATE_ORDER']
  ] as const)('validates resulting locked PATCH state and rolls back for %s', async (patch, code) => {
    const current = { ...address, calle: 'calle' in patch && patch.calle === null ? 'Only content' : address.calle, direccion_completa: null, fecha_inicio: '2026-09-01', fecha_fin: '2026-09-30' };
    const query = vi.fn()
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ empresa_id: '2' }] })
      .mockResolvedValueOnce({ rows: [{ estatus: 'ACTIVO' }] })
      .mockResolvedValueOnce({ rows: [current] }).mockResolvedValueOnce(undefined);
    const { repository } = withClient(query);
    await expect(repository.update('9', patch, 'request-patch', { userId: '4', userEmail: 'u@example.test' })).rejects.toMatchObject({ code });
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE core.direcciones direccion'))).toBe(false);
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
  });

  it('treats fiscal-owned address IDs as missing without mutation', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce(undefined);
    const { repository } = withClient(query);
    await expect(repository.changeStatus('7', 'INACTIVA', 'r', { userId: '3', userEmail: null })).resolves.toBeNull();
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE core.direcciones'))).toBe(false);
    expect(query.mock.calls[5]?.[0]).toContain('empresa_fiscal_id IS NULL');
  });
});
