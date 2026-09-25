import { describe, expect, it, vi } from 'vitest';
import { ProviderType, type CreateProviderDto } from '../src/providers/dto/create-provider.dto';
import { ProvidersRepository } from '../src/providers/providers.repository';
import { ProvidersService } from '../src/providers/providers.service';

const identity = { userId: null, userEmail: null };
const input: CreateProviderDto = { commercialName: 'TRANSPORTES KARINA', providerType: ProviderType.Freight, notes: null };
const DESTINATION = 'FLETES\\TRANSPORTES KARINA\\PAGOS\\NOTIFICACIONES DE PAGO\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}';
const DEFAULT_DESTINATION = 'PAGOS\\NOTIFICACIONES DE PAGO\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}';

function fakeClient(handler: (sql: string, params?: unknown[]) => unknown) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => { calls.push({ sql, params }); return handler(sql, params) ?? { rows: [] }; });
  const client = { query, release: vi.fn() };
  return { calls, client, repository: new ProvidersRepository({ connect: vi.fn().mockResolvedValue(client) } as never) };
}

const insertedCompany = (dropbox: string | null) => ({ rows: [{ empresa_id: '121', tipo_empresa: 'FLETE', nombre_comercial: 'TRANSPORTES KARINA', estatus: 'ACTIVO', observaciones: null, ruta_dropbox: dropbox }] });

describe('ProvidersRepository.create — payment notification config', () => {
  it('creates the config row (false/false) with the derived ruta_destino in the SAME transaction, before COMMIT', async () => {
    const { repository, calls } = fakeClient((sql) => sql.includes('INSERT INTO core.empresas ') ? insertedCompany('FLETES/TRANSPORTES KARINA') : undefined);
    await repository.create({ ...input, rutaDropbox: 'FLETES/TRANSPORTES KARINA' }, 'req-1', identity);

    const company = calls.find((call) => call.sql.includes('INSERT INTO core.empresas '))!;
    expect(company.sql).toContain('ruta_dropbox');
    expect(company.params).toEqual(['FLETE', 'TRANSPORTES KARINA', null, 'FLETES/TRANSPORTES KARINA']);

    const configIndex = calls.findIndex((call) => call.sql.includes('INSERT INTO core.empresas_notificacion_pago'));
    const commitIndex = calls.findIndex((call) => call.sql === 'COMMIT');
    expect(configIndex).toBeGreaterThan(calls.findIndex((call) => call.sql.includes('INSERT INTO core.empresa_roles')));
    expect(configIndex).toBeLessThan(commitIndex);
    expect(calls[configIndex]!.sql).toContain('VALUES ($1, FALSE, FALSE, $2)');
    expect(calls[configIndex]!.params).toEqual(['121', DESTINATION]);
  });

  it('never activates automatically: no code path writes TRUE for the flags on creation', async () => {
    const { repository, calls } = fakeClient((sql) => sql.includes('INSERT INTO core.empresas ') ? insertedCompany(null) : undefined);
    await repository.create(input, 'req-1', identity);
    const config = calls.find((call) => call.sql.includes('INSERT INTO core.empresas_notificacion_pago'))!;
    expect(config.sql).not.toMatch(/TRUE/);
    expect(config.params).not.toContain(true);
  });

  it('without a dropbox path the row still gets the NOT NULL schema-default destination', async () => {
    const { repository, calls } = fakeClient((sql) => sql.includes('INSERT INTO core.empresas ') ? insertedCompany(null) : undefined);
    await repository.create(input, 'req-1', identity);
    expect(calls.find((call) => call.sql.includes('INSERT INTO core.empresas_notificacion_pago'))!.params).toEqual(['121', DEFAULT_DESTINATION]);
  });

  it('a failing config insert rolls the WHOLE creation back and never commits (no half-created company)', async () => {
    const failure = Object.assign(new Error('permission denied for table empresas_notificacion_pago'), { code: '42501' });
    const { repository, calls, client } = fakeClient((sql) => {
      if (sql.includes('INSERT INTO core.empresas ')) return insertedCompany('FLETES/TRANSPORTES KARINA');
      if (sql.includes('INSERT INTO core.empresas_notificacion_pago')) throw failure;
      return undefined;
    });
    await expect(repository.create({ ...input, rutaDropbox: 'FLETES/TRANSPORTES KARINA' }, 'req-1', identity)).rejects.toBe(failure);
    expect(calls.some((call) => call.sql === 'COMMIT')).toBe(false);
    expect(calls.at(-1)!.sql).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });
});

describe('ProvidersRepository.update — ruta_dropbox / ruta_destino', () => {
  const lockedCompany = (dropbox: string | null) => ({ rows: [{ empresa_id: '121', tipo_empresa: 'FLETE', nombre_comercial: 'TRANSPORTES KARINA', observaciones: null, estatus: 'ACTIVO', ruta_dropbox: dropbox }] });

  function updateClient(current: string | null, options: { active?: boolean } = {}) {
    return fakeClient((sql) => {
      if (sql.includes('FROM core.empresas WHERE empresa_id = $1 FOR UPDATE')) return lockedCompany(current);
      if (sql.includes('FROM core.empresa_roles WHERE empresa_id = $1 AND estatus')) return { rows: [{ rol: 'FLETE' }] };
      if (sql.includes('notificaciones_activas = TRUE')) return { rows: options.active ? [{}] : [] };
      return undefined;
    });
  }

  it('updates ruta_dropbox and syncs ruta_destino in the same transaction', async () => {
    const { repository, calls } = updateClient(null);
    vi.spyOn(repository, 'findById').mockResolvedValue(null);
    await repository.update('121', { rutaDropbox: 'FLETES/TRANSPORTES KARINA' }, 'req-1', identity);
    const dropboxUpdate = calls.findIndex((call) => call.sql.includes('UPDATE core.empresas SET ruta_dropbox'));
    const sync = calls.findIndex((call) => call.sql.includes('ON CONFLICT (empresa_id) DO UPDATE SET ruta_destino'));
    expect(calls[dropboxUpdate]!.params).toEqual(['FLETES/TRANSPORTES KARINA', '121']);
    expect(calls[sync]!.params).toEqual(['121', DESTINATION]);
    expect(dropboxUpdate).toBeGreaterThan(-1);
    expect(sync).toBeGreaterThan(dropboxUpdate);
    expect(sync).toBeLessThan(calls.findIndex((call) => call.sql === 'COMMIT'));
  });

  it('does nothing when the path did not change', async () => {
    const { repository, calls } = updateClient('FLETES/TRANSPORTES KARINA');
    vi.spyOn(repository, 'findById').mockResolvedValue(null);
    await repository.update('121', { rutaDropbox: 'FLETES/TRANSPORTES KARINA' }, 'req-1', identity);
    expect(calls.some((call) => call.sql.includes('UPDATE core.empresas SET ruta_dropbox'))).toBe(false);
    expect(calls.some((call) => call.sql.includes('empresas_notificacion_pago'))).toBe(false);
  });

  it('does not touch the path when the field is omitted', async () => {
    const { repository, calls } = updateClient('FLETES/TRANSPORTES KARINA');
    vi.spyOn(repository, 'findById').mockResolvedValue(null);
    await repository.update('121', { notes: 'x' }, 'req-1', identity);
    expect(calls.some((call) => call.sql.includes('ruta_dropbox ='))).toBe(false);
  });

  it('clearing the path resets ruta_destino to the schema default', async () => {
    const { repository, calls } = updateClient('FLETES/TRANSPORTES KARINA');
    vi.spyOn(repository, 'findById').mockResolvedValue(null);
    await repository.update('121', { rutaDropbox: null }, 'req-1', identity);
    expect(calls.find((call) => call.sql.includes('UPDATE core.empresas SET ruta_dropbox'))!.params).toEqual([null, '121']);
    expect(calls.find((call) => call.sql.includes('ON CONFLICT (empresa_id) DO UPDATE SET ruta_destino'))!.params).toEqual(['121', DEFAULT_DESTINATION]);
  });

  it('refuses to clear the path while notifications are active, and rolls back', async () => {
    const { repository, calls } = updateClient('FLETES/TRANSPORTES KARINA', { active: true });
    await expect(repository.update('121', { rutaDropbox: null }, 'req-1', identity)).rejects.toMatchObject({ code: 'PAYMENT_NOTIFICATIONS_DROPBOX_PATH_IN_USE' });
    expect(calls.some((call) => call.sql.includes('UPDATE core.empresas SET ruta_dropbox'))).toBe(false);
    expect(calls.at(-1)!.sql).toBe('ROLLBACK');
  });
});

describe('ProvidersService — rutaDropbox', () => {
  it('canonicalizes "\\" to "/" before it reaches the repository and never persists an absolute path', async () => {
    const create = vi.fn().mockResolvedValue({ company: { empresa_id: '121', tipo_empresa: 'FLETE', nombre_comercial: 'X', estatus: 'ACTIVO', observaciones: null, ruta_dropbox: 'FLETES/TRANSPORTES KARINA' }, fiscal: null });
    const service = new ProvidersService({ create } as never);
    const response = await service.create({ ...input, rutaDropbox: '  FLETES\\TRANSPORTES KARINA\\ ' }, 'req', identity);
    expect(create.mock.calls[0]![0].rutaDropbox).toBe('FLETES/TRANSPORTES KARINA');
    expect(response.data.rutaDropbox).toBe('FLETES/TRANSPORTES KARINA');
  });

  it.each([['C:\\Users\\06\\Documents\\Dropbox\\FLETES'], ['\\\\server\\share\\x'], ['/etc/x'], ['FLETES/../x']])('create rejects %s with a stable code and never reaches the repository', async (rutaDropbox) => {
    const create = vi.fn();
    const service = new ProvidersService({ create } as never);
    await expect(service.create({ ...input, rutaDropbox }, 'req', identity)).rejects.toMatchObject({ status: 400, response: { code: expect.stringMatching(/^DROPBOX_PATH_/) } });
    expect(create).not.toHaveBeenCalled();
  });

  it('a blank path on create becomes null', async () => {
    const create = vi.fn().mockResolvedValue({ company: { empresa_id: '1', tipo_empresa: 'FLETE', nombre_comercial: 'X', estatus: 'ACTIVO', observaciones: null, ruta_dropbox: null }, fiscal: null });
    await new ProvidersService({ create } as never).create({ ...input, rutaDropbox: null }, 'req', identity);
    expect(create.mock.calls[0]![0].rutaDropbox).toBeNull();
  });

  it('update: undefined stays undefined, a value is canonicalized, blank clears, invalid is rejected', async () => {
    const found = { id: '1', commercial_name: 'X', provider_type: 'FLETE', roles: [], aliases: [], other_aliases: [], status: 'ACTIVO', notes: null, dropbox_path: null, fiscal_id: null, legal_name: null, rfc: null };
    const update = vi.fn().mockResolvedValue(found);
    const service = new ProvidersService({ update } as never);
    await service.update('1', { notes: 'x' }, 'req', identity);
    expect(update.mock.calls[0]![1]).not.toHaveProperty('rutaDropbox');
    await service.update('1', { rutaDropbox: 'A\\B' }, 'req', identity);
    expect(update.mock.calls[1]![1].rutaDropbox).toBe('A/B');
    await service.update('1', { rutaDropbox: null }, 'req', identity);
    expect(update.mock.calls[2]![1].rutaDropbox).toBeNull();
    await expect(service.update('1', { rutaDropbox: 'D:\\x' }, 'req', identity)).rejects.toMatchObject({ status: 400 });
    expect(update).toHaveBeenCalledTimes(3);
  });

  it('maps PAYMENT_NOTIFICATIONS_DROPBOX_PATH_IN_USE to a 409 domain error', async () => {
    const service = new ProvidersService({ update: vi.fn().mockRejectedValue({ code: 'PAYMENT_NOTIFICATIONS_DROPBOX_PATH_IN_USE' }) } as never);
    await expect(service.update('1', { rutaDropbox: null }, 'req', identity)).rejects.toMatchObject({ status: 409, response: { code: 'PAYMENT_NOTIFICATIONS_DROPBOX_PATH_IN_USE' } });
  });

  it('get exposes rutaDropbox', async () => {
    const found = { id: '1', commercial_name: 'X', provider_type: 'FLETE', roles: ['FLETE'], aliases: [], other_aliases: [], status: 'ACTIVO', notes: null, dropbox_path: 'FLETES/KARINA', fiscal_id: null, legal_name: null, rfc: null };
    const service = new ProvidersService({ findById: vi.fn().mockResolvedValue(found) } as never);
    expect((await service.get('1')).data.rutaDropbox).toBe('FLETES/KARINA');
  });
});
