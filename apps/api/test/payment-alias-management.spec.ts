import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';
import { AliasesRepository } from '../src/aliases/aliases.repository';
import { AliasesService } from '../src/aliases/aliases.service';
import { ManagePaymentAliasDto } from '../src/aliases/dto/manage-payment-alias.dto';
import { resolvePaymentAlias, type PaymentAliasRecord } from '../src/aliases/payment-alias-resolution';

const record: PaymentAliasRecord = { aliasId: '9007199254740993', companyId: '121', companyName: 'Empresa A', alias: 'Álias--PDF', normalizedAlias: 'ALIAS PDF', status: 'ACTIVO', type: 'NOMBRE_ARCHIVO', updatedAt: '2026-10-19 21:00:00.123456+00' };
const identity = { userId: '42', userEmail: 'actor@example.test' };
const change: ManagePaymentAliasDto = { action: 'REASSIGN', companyId: '122', expectedCompanyId: '121', expectedUpdatedAt: record.updatedAt, confirmed: true };

describe('current payment alias resolution', () => {
  it('distinguishes missing, active and inactive assignments independent of the historical error', () => {
    expect(resolvePaymentAlias('Alias PDF', [], []).state).toBe('UNASSIGNED');
    expect(resolvePaymentAlias(' alias_pdf ', [record], [])).toMatchObject({ state: 'ACTIVE', company: { id: '121' }, assignment: { aliasId: record.aliasId } });
    expect(resolvePaymentAlias('Alias PDF', [{ ...record, status: 'INACTIVO' }], [])).toMatchObject({ state: 'INACTIVE', company: null });
  });
  it('does not confuse inactive history with a new active assignment', () => {
    expect(resolvePaymentAlias('Alias PDF', [{ ...record, status: 'INACTIVO' }, { ...record, aliasId: '2', companyId: '122' }], [])).toMatchObject({ state: 'ACTIVE', company: { id: '122' } });
  });
  it('detects ambiguities, including commercial names and multiple equivalent alias records', () => {
    expect(resolvePaymentAlias('Alias PDF', [record], [{ id: '122', name: 'ALIAS PDF' }]).state).toBe('CONFLICT');
    expect(resolvePaymentAlias('Alias PDF', [record, { ...record, aliasId: '2' }], []).state).toBe('CONFLICT');
  });
  it('keeps recognition by commercial name separate from a deactivated alias', () => {
    expect(resolvePaymentAlias('Alias PDF', [{ ...record, status: 'INACTIVO' }], [{ id: '121', name: 'ALIAS PDF' }])).toMatchObject({ state: 'NAME_ONLY', assignment: null });
  });
});

describe('payment alias mutation validation', () => {
  it.each([
    { ...change, confirmed: false }, { ...change, companyId: undefined }, { ...change, expectedCompanyId: '01' },
    { ...change, expectedUpdatedAt: 42 }, { ...change, estatus: 'ACTIVO' }, { ...change, action: 'DELETE' }
  ])('rejects invalid or unconfirmed request %#', async (input) => {
    expect(await validate(plainToInstance(ManagePaymentAliasDto, input), { whitelist: true, forbidNonWhitelisted: true })).not.toHaveLength(0);
  });
});

function harness(current: PaymentAliasRecord | null = record, candidates: unknown[] = []) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FOR UPDATE OF a')) return { rows: current ? [current] : [] };
    if (sql.startsWith('SELECT nombre_comercial')) return { rows: [{ name: 'Empresa B' }] };
    if (sql.includes('UNION ALL')) return { rows: candidates };
    if (sql.includes('AS "aliasId"')) return { rows: [{ ...record, companyId: '122', status: 'INACTIVO' }] };
    return { rows: [] };
  });
  const client = { query, release: vi.fn() };
  return { repository: new AliasesRepository({ connect: vi.fn().mockResolvedValue(client) } as never), query, client };
}

describe('audited alias management', () => {
  it('updates the existing relation by exact alias ID, preserving the row and audit context', async () => {
    const { repository, query, client } = harness();
    await repository.managePaymentAlias(record.aliasId, change, 'request-change', identity);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('SET empresa_id = $2'), [record.aliasId, '122']);
    expect(query).toHaveBeenCalledWith("SELECT set_config('app.user_id', COALESCE($1, ''), true)", ['42']);
    expect(query).toHaveBeenCalledWith("SELECT set_config('app.request_id', $1, true)", ['request-change']);
    expect(query).toHaveBeenCalledWith('COMMIT');
    expect(query.mock.calls.some(([sql]) => /^(DELETE|INSERT)/.test(sql) || /UPDATE core\.(correos|resultados)/.test(sql))).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
  });
  it('deactivates without deleting, reinserting or changing the company', async () => {
    const { repository, query } = harness();
    await repository.managePaymentAlias(record.aliasId, { ...change, action: 'DEACTIVATE' }, 'r', identity);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SET estatus = 'INACTIVO'"), [record.aliasId]);
    expect(query.mock.calls.some(([sql]) => /^(DELETE|INSERT)/.test(sql) || sql.includes('SET empresa_id'))).toBe(false);
  });
  it.each([
    { ...record, companyId: '999' }, { ...record, updatedAt: 'new-version' }, { ...record, status: 'INACTIVO' as const }
  ])('rejects stale snapshots %# before mutation', async (current) => {
    const { repository, query } = harness(current);
    await expect(repository.managePaymentAlias(record.aliasId, change, 'r', identity)).rejects.toMatchObject({ code: 'ALIAS_STATE_CHANGED' });
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query.mock.calls.some(([sql]) => /^UPDATE/.test(sql))).toBe(false);
  });
  it.each([
    { company_id: '123', alias: 'ÁLIAS PDF', stored_alias: false },
    { company_id: '122', alias: 'ÁLIAS PDF', stored_alias: true }
  ])('rejects commercial-name conflicts and canonical duplicates at the target %#', async (candidate) => {
    const { repository, query } = harness(record, [candidate]);
    await expect(repository.managePaymentAlias(record.aliasId, change, 'r', identity)).rejects.toMatchObject({ code: 'ALIAS_ALREADY_ASSOCIATED' });
    expect(query).toHaveBeenCalledWith('ROLLBACK');
  });
  it('returns not found for a missing row', async () => {
    const { repository } = harness(null);
    await expect(repository.managePaymentAlias('999', change, 'r', identity)).resolves.toBeNull();
  });
  it.each(['ALIAS_STATE_CHANGED', 'ALIAS_ALREADY_ASSOCIATED'])('maps %s to a safe conflict response', async (code) => {
    const service = new AliasesService({ managePaymentAlias: vi.fn().mockRejectedValue({ code }) } as never);
    await expect(service.managePaymentAlias('1', change, 'r', identity)).rejects.toMatchObject({ status: 409, response: { code } });
  });
});
