import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  assertConfiguredDatabaseAllowed,
  assertLiveDatabaseAllowed,
  detectContainer,
  isProductionDatabaseName,
  isProductionDatabaseRole,
  isProductionRuntime,
  ProductionDatabaseGuardError,
  verifyDatabaseBeforeListening,
  type RuntimeSignals
} from '../src/config/production-database-guard';

// Every scenario with the production database is simulated: no test here opens a connection.
const DEV: RuntimeSignals = { nodeEnv: undefined, inContainer: false };
const TEST: RuntimeSignals = { nodeEnv: 'test', inContainer: false };
const HOST_WITH_PRODUCTION_NODE_ENV: RuntimeSignals = { nodeEnv: 'production', inContainer: false };
const CONTAINER_WITHOUT_PRODUCTION_NODE_ENV: RuntimeSignals = { nodeEnv: 'development', inContainer: true };
const PRODUCTION: RuntimeSignals = { nodeEnv: 'production', inContainer: true };

const TEST_DB = { name: 'daubert_hub_test', user: 'daubert_hub_test_user' };
const PROD_DB = { name: 'daubert_global', user: 'daubert_hub_app' };

async function failureOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the guard to reject');
}

const liveRow = (database_name: string | null, role_name: string | null) => ({ database_name, role_name });
const database = (rows: ReturnType<typeof liveRow>[] | Error) => ({
  query: vi.fn(async () => {
    if (rows instanceof Error) throw rows;
    return rows as never;
  })
});

describe('runtime detection', () => {
  it('detects a container from /.dockerenv or /run/.containerenv only', () => {
    expect(detectContainer((p) => p === '/.dockerenv')).toBe(true);
    expect(detectContainer((p) => p === '/run/.containerenv')).toBe(true);
    expect(detectContainer(() => false)).toBe(false);
  });

  it('treats only NODE_ENV=production INSIDE a container as the production runtime (NODE_ENV alone is not a boundary)', () => {
    expect(isProductionRuntime(PRODUCTION)).toBe(true);
    expect(isProductionRuntime(HOST_WITH_PRODUCTION_NODE_ENV)).toBe(false);
    expect(isProductionRuntime(CONTAINER_WITHOUT_PRODUCTION_NODE_ENV)).toBe(false);
    expect(isProductionRuntime(DEV)).toBe(false);
    expect(isProductionRuntime(TEST)).toBe(false);
  });

  it('recognises the production database and role regardless of case and whitespace', () => {
    for (const name of ['daubert_global', 'DAUBERT_GLOBAL', '  Daubert_Global  ']) expect(isProductionDatabaseName(name)).toBe(true);
    for (const name of ['daubert_hub_test', 'daubert_global_copy', '', null, undefined]) expect(isProductionDatabaseName(name)).toBe(false);
    expect(isProductionDatabaseRole(' DAUBERT_HUB_APP ')).toBe(true);
    expect(isProductionDatabaseRole('daubert_hub_test_user')).toBe(false);
  });
});

describe('configured database check (before any connection)', () => {
  it.each([['development', DEV], ['TEST', TEST]])('%s + daubert_hub_test is allowed', (_name, runtime) => {
    expect(() => assertConfiguredDatabaseAllowed(TEST_DB, runtime)).not.toThrow();
  });

  it.each([['development', DEV], ['TEST', TEST], ['host with NODE_ENV=production', HOST_WITH_PRODUCTION_NODE_ENV], ['container without NODE_ENV=production', CONTAINER_WITHOUT_PRODUCTION_NODE_ENV]])('%s + daubert_global is rejected', (_name, runtime) => {
    expect(() => assertConfiguredDatabaseAllowed({ name: 'daubert_global', user: 'someone_else' }, runtime)).toThrow(ProductionDatabaseGuardError);
    expect(() => assertConfiguredDatabaseAllowed({ name: ' DAUBERT_GLOBAL ', user: 'someone_else' }, runtime)).toThrow(/production database "daubert_global"/);
  });

  it('rejects the production role outside the production runtime even against another database', () => {
    expect(() => assertConfiguredDatabaseAllowed({ name: 'daubert_hub_test', user: 'daubert_hub_app' }, DEV)).toThrow(/production role "daubert_hub_app"/);
  });

  it('accepts the legitimate production configuration in the production runtime', () => {
    expect(() => assertConfiguredDatabaseAllowed(PROD_DB, PRODUCTION)).not.toThrow();
  });
});

describe('live database check', () => {
  it('rejects a connection that really landed on the production database even if the configured name looks safe', () => {
    expect(() => assertLiveDatabaseAllowed({ databaseName: 'daubert_global', roleName: 'daubert_hub_test_user' }, TEST_DB, DEV)).toThrow(/live connection reports the production database/);
  });

  it('rejects a difference between the configured DB_NAME and current_database()', () => {
    expect(() => assertLiveDatabaseAllowed({ databaseName: 'some_other_db', roleName: 'daubert_hub_test_user' }, TEST_DB, DEV)).toThrow(/DB_NAME is "daubert_hub_test" but the live connection reports "some_other_db"/);
    expect(() => assertLiveDatabaseAllowed({ databaseName: null, roleName: 'daubert_hub_test_user' }, TEST_DB, DEV)).toThrow(/\(unknown\)/);
  });

  it('rejects the production role on the live connection', () => {
    expect(() => assertLiveDatabaseAllowed({ databaseName: 'daubert_hub_test', roleName: 'daubert_hub_app' }, TEST_DB, DEV)).toThrow(/production role/);
  });

  it('is a no-op in the production runtime', () => {
    expect(() => assertLiveDatabaseAllowed({ databaseName: 'daubert_global', roleName: 'daubert_hub_app' }, PROD_DB, PRODUCTION)).not.toThrow();
  });
});

describe('verifyDatabaseBeforeListening', () => {
  it('development + daubert_hub_test: allowed, verified with one read-only SELECT', async () => {
    const db = database([liveRow('daubert_hub_test', 'daubert_hub_test_user')]);
    await expect(verifyDatabaseBeforeListening(db, { configured: TEST_DB, runtime: DEV })).resolves.toEqual({ liveDatabaseName: 'daubert_hub_test' });
    expect(db.query).toHaveBeenCalledTimes(1);
    const sql = String((db.query.mock.calls[0] as unknown[])[0]);
    expect(sql).toMatch(/^SELECT current_database\(\)/);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
  });

  it('TEST + daubert_hub_test: allowed', async () => {
    const db = database([liveRow('daubert_hub_test', 'daubert_hub_test_user')]);
    await expect(verifyDatabaseBeforeListening(db, { configured: TEST_DB, runtime: TEST })).resolves.toBeDefined();
  });

  it('development + daubert_global: rejected BEFORE opening any connection', async () => {
    const db = database([liveRow('daubert_global', 'daubert_hub_app')]);
    await expect(verifyDatabaseBeforeListening(db, { configured: PROD_DB, runtime: DEV })).rejects.toThrow(/production database/);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('a DB_NAME that looks safe but resolves to production on the live connection is rejected', async () => {
    const db = database([liveRow('daubert_global', 'daubert_hub_test_user')]);
    await expect(verifyDatabaseBeforeListening(db, { configured: TEST_DB, runtime: DEV })).rejects.toThrow(/live connection reports the production database/);
  });

  it('configured name different from current_database(): safe error', async () => {
    const db = database([liveRow('daubert_hub_test_copy', 'daubert_hub_test_user')]);
    await expect(verifyDatabaseBeforeListening(db, { configured: TEST_DB, runtime: DEV })).rejects.toThrow(/DB_NAME is "daubert_hub_test" but the live connection reports "daubert_hub_test_copy"/);
  });

  it('connection or validation error: fails closed with a generic message that never echoes the driver error or credentials', async () => {
    // Fake values only. The URL is assembled from parts so no credential-shaped literal sits in the source.
    const fakeConnectionString = ['postgres', '://u:secret-pass-123@10.0.0.5/db'].join('');
    const driverError = Object.assign(new Error(`password authentication failed for user "daubert_hub_test_user" at 10.0.0.5 using secret-pass-123 ${fakeConnectionString}`), { code: '28P01' });
    const db = database(driverError);
    const error = await failureOf(verifyDatabaseBeforeListening(db, { configured: TEST_DB, runtime: DEV }));
    expect(error).toBeInstanceOf(ProductionDatabaseGuardError);
    expect(error.message).toBe('Refusing to start: could not verify the live database (error code 28P01).');
    for (const leak of [/secret-pass-123/, /10\.0\.0\.5/, /postgres:\/\//, /password authentication/, /daubert_hub_test_user/]) expect(error.message).not.toMatch(leak);
  });

  it('a failure without an error code is still generic', async () => {
    const error = await failureOf(verifyDatabaseBeforeListening(database(new Error('boom host=secret')), { configured: TEST_DB, runtime: DEV }));
    expect(error.message).toBe('Refusing to start: could not verify the live database.');
  });

  it('an empty result (no row) is rejected as an unknown live database', async () => {
    await expect(verifyDatabaseBeforeListening(database([]), { configured: TEST_DB, runtime: DEV })).rejects.toThrow(/\(unknown\)/);
  });

  it('the dev launcher expectation (EXPECTED_DATABASE_NAME) still applies and keeps its message', async () => {
    const db = database([liveRow('daubert_hub_test', 'daubert_hub_test_user')]);
    await expect(verifyDatabaseBeforeListening(db, { configured: TEST_DB, runtime: DEV, expectedDatabaseName: 'daubert_hub_test' })).resolves.toBeDefined();
    await expect(verifyDatabaseBeforeListening(db, { configured: TEST_DB, runtime: DEV, expectedDatabaseName: 'other' })).rejects.toThrow('Refusing to start: expected database "other" but the live connection reports "daubert_hub_test".');
  });

  describe('production runtime (behaviour preserved)', () => {
    it('legitimate PRODUCTION configuration starts with no extra query and no new failure mode', async () => {
      const db = database([liveRow('daubert_global', 'daubert_hub_app')]);
      await expect(verifyDatabaseBeforeListening(db, { configured: PROD_DB, runtime: PRODUCTION })).resolves.toEqual({ liveDatabaseName: undefined });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('still starts when the database is temporarily unavailable (no query is made at all)', async () => {
      const db = database(new Error('ECONNREFUSED'));
      await expect(verifyDatabaseBeforeListening(db, { configured: PROD_DB, runtime: PRODUCTION })).resolves.toBeDefined();
      expect(db.query).not.toHaveBeenCalled();
    });

    it('keeps honouring EXPECTED_DATABASE_NAME if someone sets it (pre-existing behaviour)', async () => {
      const db = database([liveRow('daubert_global', 'daubert_hub_app')]);
      await expect(verifyDatabaseBeforeListening(db, { configured: PROD_DB, runtime: PRODUCTION, expectedDatabaseName: 'daubert_global' })).resolves.toEqual({ liveDatabaseName: 'daubert_global' });
      await expect(verifyDatabaseBeforeListening(db, { configured: PROD_DB, runtime: PRODUCTION, expectedDatabaseName: 'daubert_hub_test' })).rejects.toThrow('Refusing to start');
    });
  });
});

describe('direct start wiring (main.ts)', () => {
  const main = readFileSync(join(__dirname, '..', 'src', 'main.ts'), 'utf8');

  it('runs the guard before the API starts listening, and exits the process if it fails', () => {
    const guardCall = main.indexOf('await assertDatabaseSafeBeforeListening(app)');
    const listen = main.indexOf('await app.listen(');
    expect(guardCall).toBeGreaterThan(-1);
    expect(listen).toBeGreaterThan(guardCall);
    const handler = main.slice(main.indexOf('async function assertDatabaseSafeBeforeListening'), main.indexOf('async function bootstrap'));
    expect(handler).toContain('await app.close()');
    expect(handler).toContain('process.exit(1)');
  });

  it('does not depend on the dev launcher: no condition on EXPECTED_DATABASE_NAME gates the guard', () => {
    const handler = main.slice(main.indexOf('async function assertDatabaseSafeBeforeListening'), main.indexOf('async function bootstrap'));
    expect(handler).not.toMatch(/if \(!?process\.env\.EXPECTED_DATABASE_NAME/);
    expect(handler).toContain('verifyDatabaseBeforeListening');
  });
});
