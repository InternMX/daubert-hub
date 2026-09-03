import { describe, expect, it, vi } from 'vitest';
import { ClientsService } from '../src/clients/clients.service';
import type { ClientRow } from '../src/clients/clients.repository';

const identity = { userId: null, userEmail: null };
const row: ClientRow = {
  id: '9007199254740993', commercial_name: 'Acme', company_type: 'PROVEEDOR', status: 'ACTIVO', client_status: 'ACTIVO', notes: null,
  fiscal_id: null, legal_name: null, rfc: null, fiscal_start_date: null, fiscal_end_date: null,
  roles: ['PROVEEDOR', 'CLIENTE']
};

describe('ClientsService', () => {
  it('maps list/detail and preserves BIGINT IDs as strings', async () => {
    const repository = { list: vi.fn().mockResolvedValue({ total: 1, clients: [row] }), findClientById: vi.fn().mockResolvedValue(row) };
    const service = new ClientsService(repository as never);
    const listInput = { page: 1, pageSize: 25, sortOrder: 'asc' } as never;
    await expect(service.list(listInput)).resolves.toMatchObject({ data: [{ id: row.id, roles: ['PROVEEDOR', 'CLIENTE'], fiscal: null }], meta: { total: 1 } });
    await expect(service.detail(row.id)).resolves.toMatchObject({ data: { id: row.id } });
  });

  it('returns 404 only for a company with no CLIENTE role at all', async () => {
    const service = new ClientsService({ findClientById: vi.fn().mockResolvedValue(null) } as never);
    await expect(service.detail('1')).rejects.toMatchObject({ status: 404 });
  });

  it('exposes clientStatus distinctly from the company status for a multi-role company', async () => {
    const multiRole: ClientRow = { ...row, status: 'ACTIVO', client_status: 'INACTIVO', roles: ['PROVEEDOR'] };
    const service = new ClientsService({ findClientById: vi.fn().mockResolvedValue(multiRole) } as never);
    await expect(service.detail(row.id)).resolves.toMatchObject({ data: { status: 'ACTIVO', clientStatus: 'INACTIVO' } });
  });

  it.each([
    ['CLIENT_ALREADY_ACTIVE', 'CLIENT_ALREADY_ACTIVE'],
    ['CLIENT_NAME_RFC_CONFLICT', 'CLIENT_NAME_RFC_CONFLICT'],
    ['CLIENT_RFC_CONFLICT', 'CLIENT_RFC_CONFLICT']
  ])('maps identity case error %s to a safe 409', async (repositoryCode, responseCode) => {
    const service = new ClientsService({ create: vi.fn().mockRejectedValue({ code: repositoryCode }) } as never);
    await expect(service.create({ commercialName: 'Acme' }, 'request-1', identity)).rejects.toMatchObject({ status: 409, response: { code: responseCode } });
  });

  it('maps database identity constraints without leaking SQL details', async () => {
    const service = new ClientsService({ create: vi.fn().mockRejectedValue({ code: '23505', constraint: 'uq_empresas_fiscales_rfc', detail: 'secret SQL' }) } as never);
    await expect(service.create({ commercialName: 'Acme' }, 'request-1', identity)).rejects.toMatchObject({ status: 409, response: { code: 'CLIENT_RFC_CONFLICT' } });
  });

  it('allows no-fiscal creation and passes audit identity unchanged', async () => {
    const create = vi.fn().mockResolvedValue(row);
    const service = new ClientsService({ create } as never);
    await service.create({ commercialName: 'Acme' }, 'request-1', identity);
    expect(create).toHaveBeenCalledWith({ commercialName: 'Acme' }, 'request-1', identity);
  });

  it('rejects empty PATCH and invalid fiscal transitions before repository access', async () => {
    const update = vi.fn();
    const service = new ClientsService({ update } as never);
    await expect(service.update('1', {}, 'request-1', identity)).rejects.toMatchObject({ status: 400, response: { code: 'EMPTY_PATCH' } });
    await expect(service.update('1', { fiscal: { legalName: 'Acme' } }, 'request-1', identity)).rejects.toMatchObject({ status: 400 });
    await expect(service.update('1', { fiscal: { legalName: 'Acme', rfc: 'ACM010101AA1', changeMode: 'NEW_IDENTITY' as never } }, 'request-1', identity)).rejects.toMatchObject({ status: 400 });
    expect(update).not.toHaveBeenCalled();
  });

  it('keeps the paired fiscal contract identical to Providers: rfc alone is rejected', async () => {
    const update = vi.fn();
    const service = new ClientsService({ update } as never);
    await expect(service.update('1', { fiscal: { rfc: 'ACM010101AA1' } }, 'request-1', identity)).rejects.toMatchObject({ status: 400 });
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a fiscal changeMode with no legalName/rfc data before repository access', async () => {
    const update = vi.fn();
    const service = new ClientsService({ update } as never);
    await expect(service.update('1', { fiscal: { changeMode: 'CORRECTION' as never } }, 'request-1', identity)).rejects.toMatchObject({ status: 400, response: { code: 'FISCAL_CHANGE_WITHOUT_DATA' } });
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ['FISCAL_INCOMPLETE'],
    ['FISCAL_REMOVAL_NOT_ALLOWED']
  ])('maps repository fiscal error %s to a safe 400', async (repositoryCode) => {
    const service = new ClientsService({ update: vi.fn().mockRejectedValue({ code: repositoryCode }) } as never);
    await expect(service.update('1', { notes: 'x' }, 'request-1', identity)).rejects.toMatchObject({ status: 400, response: { code: repositoryCode } });
  });

  it('updates and maps current fiscal data', async () => {
    const updated = { ...row, fiscal_id: '9007199254740994', legal_name: 'Acme SA', rfc: 'ACM010101AA1' };
    const update = vi.fn().mockResolvedValue(updated);
    const service = new ClientsService({ update } as never);
    await expect(service.update(row.id, { notes: 'updated', fiscal: { legalName: 'Acme SA', rfc: 'ACM010101AA1' } }, 'request-2', identity)).resolves.toMatchObject({ data: { notes: null, fiscal: { id: '9007199254740994' } } });
    expect(update).toHaveBeenCalledWith(row.id, expect.anything(), 'request-2', identity);
  });

  it.each([
    ['deactivate', 'INACTIVO'],
    ['reactivate', 'ACTIVO']
  ] as const)('%s delegates role-aware lifecycle behavior', async (operation, target) => {
    const changeStatus = vi.fn().mockResolvedValue({ ...row, status: target });
    const service = new ClientsService({ changeStatus } as never);
    await service[operation](row.id, 'request-status', identity);
    expect(changeStatus).toHaveBeenCalledWith(row.id, target, 'request-status', identity);
  });
});
