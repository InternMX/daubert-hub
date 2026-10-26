import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { CaterpillarExecutionsRepository } from '../src/automations/remisiones-caterpillar/caterpillar-executions.repository';

const load = createRequire(resolve(__dirname, 'support/caterpillar-snapshot-rollback.cjs'));
const { rollbackOnly, snapshotDatabase } = load('./caterpillar-snapshot-rollback.cjs');
const items = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/caterpillar-normalized-items.json'), 'utf8')).normal;
const session = { pid: 17, xid: '8', documentId: '789', companyId: '77' };
const update = "UPDATE core.documentos d SET caterpillar_admission=$3::jsonb WHERE current_database()='daubert_hub_test' AND d.documento_id=$1::bigint AND d.empresa_id=$2::bigint AND d.caterpillar_admission IS NULL RETURNING d.caterpillar_admission AS snapshot";

function fakeClient(override: Record<string, unknown> = {}) {
  let snapshot: unknown = null;
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    if (text === 'ROLLBACK') { snapshot = null; return { rows: [] }; }
    if (text === 'BEGIN') return { rows: [] };
    if (text.includes('pg_backend_pid()')) return { rows: [{ db: 'daubert_hub_test', role: 'daubert_hub_test_user', ...session, ...override }] };
    if (text.includes(' AS database_name')) return { rows: [{ database_name: 'daubert_hub_test', ready: true }] };
    if (text.includes(' AS is_empty')) return { rows: [{ document_id: '789', source_company_id: '77', file_name: 'SYNTHETIC.xlsx',
      snapshot, is_empty: snapshot === null, writable: true }] };
    if (text.trim().startsWith('UPDATE core.documentos')) { snapshot = JSON.parse(String(values?.[2])); return { rows: [{ snapshot }] }; }
    return { rows: [{ n: 1 }] };
  });
  return { query, snapshot: () => snapshot };
}

describe('snapshot rollback harness — no live credentials/database', () => {
  it('runs the actual repository through ONE supplied client and always rolls back', async () => {
    const client = fakeClient();
    const repo = new CaterpillarExecutionsRepository(snapshotDatabase(client, session));
    await rollbackOnly(client, async () => {
      expect((await repo.storeAdmissionSnapshot('789', '77', items)).status).toBe('STORED');
      expect((await repo.findAdmissionSnapshot('789', '77')).status).toBe('FOUND');
      expect((await repo.storeAdmissionSnapshot('789', '77', items)).status).toBe('ALREADY_STORED');
      expect(client.snapshot()).not.toBeNull();
    });
    expect(client.snapshot()).toBeNull();
    expect(client.query.mock.calls[0]?.[0]).toBe('BEGIN');
    expect(client.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(client.query.mock.calls.some(([sql]) => /\bCOMMIT\b/.test(sql))).toBe(false);
  });
  it('rolls back if an assertion/action fails after snapshot capture', async () => {
    const client = fakeClient();
    const repo = new CaterpillarExecutionsRepository(snapshotDatabase(client, session));
    await expect(rollbackOnly(client, async () => {
      await repo.storeAdmissionSnapshot('789', '77', items);
      throw new Error('synthetic failure');
    })).rejects.toThrow('synthetic failure');
    expect(client.snapshot()).toBeNull();
    expect(client.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it.each([{ db: 'daubert_global' }, { role: 'postgres' }, { pid: 18 }, { xid: '9' }, { xid: null }])('rejects identity/client/transaction drift %j before repository SQL', async change => {
    const client = fakeClient(change);
    await expect(snapshotDatabase(client, session).query('SELECT 1')).rejects.toThrow('CAT_SNAPSHOT_SESSION_CHANGED');
    expect(client.query).toHaveBeenCalledTimes(1);
  });
  it('rejects a missing transaction ID before constructing an adapter', () => {
    expect(() => snapshotDatabase(fakeClient(), { ...session, xid: null })).toThrow('CAT_SNAPSHOT_ACTIVE_TRANSACTION_REQUIRED');
  });
  it.each(['17', '790'])('rejects UPDATE targeting a historical/different document %s', async documentId => {
    const client = fakeClient();
    await expect(snapshotDatabase(client, session).query(update, [documentId, '77', '{}'])).rejects.toThrow('CAT_SNAPSHOT_NON_FIXTURE_WRITE_REJECTED');
    expect(client.query).toHaveBeenCalledTimes(1);
  });
  it.each(['COMMIT', 'ROLLBACK', 'DELETE FROM core.documentos', 'INSERT INTO core.documentos VALUES(1)',
    'SELECT 1; COMMIT', 'UPDATE operacion.remisiones SET estatus=\'CANCELADA\''])('rejects unapproved adapter statement %s', async sql => {
    const client = fakeClient();
    await expect(snapshotDatabase(client, session).query(sql)).rejects.toThrow(/CAT_SNAPSHOT_/);
    expect(client.query).toHaveBeenCalledTimes(1);
  });
  it('fails closed without TEST variables before TypeScript/API initialization or connection', () => {
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP']) if (process.env[key]) env[key] = process.env[key];
    const child = spawnSync(process.execPath, [resolve(__dirname, 'caterpillar-admission.integration.runner.cjs')], { env, encoding: 'utf8', timeout: 10000 });
    expect(child.status).toBe(2);
    expect(JSON.parse(child.stdout)).toMatchObject({ result: 'TEST_SNAPSHOT_INTEGRATION_BLOCKED', writesAttempted: false,
      available: { TEST_DATABASE_URL_MIGRATOR: false, TEST_DATABASE_URL: false } });
    expect(child.stderr).toBe('');
  });
  it('runner uses an explicit identity value and never calls sequence mutators or commit', () => {
    const code = readFileSync(resolve(__dirname, 'caterpillar-admission.integration.runner.cjs'), 'utf8');
    expect(code).toContain('OVERRIDING SYSTEM VALUE');
    expect(code).not.toMatch(/\.query\(['"`]\s*(COMMIT|SELECT\s+(nextval|setval))/i);
    expect(code).not.toContain('new DatabaseService');
  });
});
