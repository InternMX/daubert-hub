import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SafeUser } from '../src/security/users.types';
import {
  assertLiveDatabaseAndRole,
  assertProductionBootstrapGuards,
  assertSecuritySchemaReady,
  assertUsersTableEmpty,
  createProductionAdmin,
  EXPECTED_DATABASE,
  guardedProdDatabaseUrl,
  PROD_BOOTSTRAP_ORIGIN
} from '../scripts/bootstrap-admin-prod';

const ORIGINAL_ENV = { ...process.env };

function safeUser(overrides: Partial<SafeUser> = {}): SafeUser {
  return {
    id: '1',
    displayName: 'Primer Admin',
    email: 'admin@daubert.mx',
    role: 'ADMIN',
    status: 'ACTIVE',
    mustChangePassword: true,
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
    lastLoginAt: null,
    ...overrides
  };
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.PROD_DATABASE_URL;
  delete process.env.TEST_DATABASE_URL;
  delete process.env.DB_HOST;
  delete process.env.DB_PORT;
  delete process.env.DB_NAME;
  delete process.env.DB_USER;
  delete process.env.DB_PASSWORD;
});

describe('guardedProdDatabaseUrl', () => {
  it('accepts a PROD_DATABASE_URL pointing exactly at daubert_global', () => {
    process.env.PROD_DATABASE_URL = 'postgres://daubert_hub_app:s3cr3t@prod-host:5432/daubert_global';
    const url = guardedProdDatabaseUrl();
    expect(decodeURIComponent(url.pathname).replace(/^\//, '')).toBe(EXPECTED_DATABASE);
  });

  it('refuses daubert_hub_test', () => {
    process.env.PROD_DATABASE_URL = 'postgres://daubert_hub_app:s3cr3t@prod-host:5432/daubert_hub_test';
    expect(() => guardedProdDatabaseUrl()).toThrow(/restricted to daubert_global/);
  });

  it('refuses any other database name', () => {
    process.env.PROD_DATABASE_URL = 'postgres://daubert_hub_app:s3cr3t@prod-host:5432/some_other_db';
    expect(() => guardedProdDatabaseUrl()).toThrow(/restricted to daubert_global/);
  });

  it('fails closed when PROD_DATABASE_URL is missing, and never falls back to TEST_DATABASE_URL', () => {
    delete process.env.PROD_DATABASE_URL;
    process.env.TEST_DATABASE_URL = 'postgres://user:pass@localhost:5432/daubert_hub_test';
    expect(() => guardedProdDatabaseUrl()).toThrow(/PROD_DATABASE_URL must be set/);
  });

  it('fails closed when PROD_DATABASE_URL is missing, and never falls back to DB_* variables', () => {
    delete process.env.PROD_DATABASE_URL;
    process.env.DB_HOST = 'prod-host';
    process.env.DB_PORT = '5432';
    process.env.DB_NAME = 'daubert_global';
    process.env.DB_USER = 'daubert_hub_app';
    process.env.DB_PASSWORD = 'super-secret';
    expect(() => guardedProdDatabaseUrl()).toThrow(/PROD_DATABASE_URL must be set/);
  });

  it('rejects a malformed URL', () => {
    process.env.PROD_DATABASE_URL = 'not-a-valid-url';
    expect(() => guardedProdDatabaseUrl()).toThrow(/valid PostgreSQL URL/);
  });

  it('never leaks the credential-bearing URL itself in its error message', () => {
    process.env.PROD_DATABASE_URL = 'postgres://daubert_hub_app:s3cr3t-password@prod-host:5432/daubert_hub_test';
    try {
      guardedProdDatabaseUrl();
      expect.unreachable('expected guardedProdDatabaseUrl to throw');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('s3cr3t-password');
      expect(message).not.toContain(process.env.PROD_DATABASE_URL);
    }
  });
});

describe('assertLiveDatabaseAndRole', () => {
  it('passes when the live connection reports daubert_global and daubert_hub_app', async () => {
    const database = { query: vi.fn().mockResolvedValue([{ database_name: 'daubert_global', role_name: 'daubert_hub_app' }]) };
    await expect(assertLiveDatabaseAndRole(database)).resolves.toBeUndefined();
  });

  it('refuses a live database mismatch even when the URL claimed daubert_global', async () => {
    const database = { query: vi.fn().mockResolvedValue([{ database_name: 'daubert_hub_test', role_name: 'daubert_hub_app' }]) };
    await expect(assertLiveDatabaseAndRole(database)).rejects.toThrow(/expected "daubert_global"/);
  });

  it('refuses any PostgreSQL role other than daubert_hub_app', async () => {
    const database = { query: vi.fn().mockResolvedValue([{ database_name: 'daubert_global', role_name: 'postgres' }]) };
    await expect(assertLiveDatabaseAndRole(database)).rejects.toThrow(/expected "daubert_hub_app"/);
  });
});

describe('assertSecuritySchemaReady', () => {
  it('passes when both security.users and security.sessions exist', async () => {
    const database = { query: vi.fn().mockResolvedValue([{ users_table_exists: true, sessions_table_exists: true }]) };
    await expect(assertSecuritySchemaReady(database)).resolves.toBeUndefined();
  });

  it('refuses when security.users does not exist', async () => {
    const database = { query: vi.fn().mockResolvedValue([{ users_table_exists: false, sessions_table_exists: true }]) };
    await expect(assertSecuritySchemaReady(database)).rejects.toThrow(/security\.users does not exist/);
  });

  it('refuses when security.sessions does not exist', async () => {
    const database = { query: vi.fn().mockResolvedValue([{ users_table_exists: true, sessions_table_exists: false }]) };
    await expect(assertSecuritySchemaReady(database)).rejects.toThrow(/security\.sessions does not exist/);
  });
});

describe('assertUsersTableEmpty', () => {
  it('passes when security.users has zero rows', async () => {
    const database = { query: vi.fn().mockResolvedValue([{ user_count: 0 }]) };
    await expect(assertUsersTableEmpty(database)).resolves.toBeUndefined();
  });

  it('refuses with a clear message when security.users is non-empty', async () => {
    const database = { query: vi.fn().mockResolvedValue([{ user_count: 1 }]) };
    await expect(assertUsersTableEmpty(database)).rejects.toThrow(
      'Production bootstrap refused: security.users is not empty. Create additional users through Daubert Hub administration.'
    );
  });
});

describe('assertProductionBootstrapGuards', () => {
  it('runs the database/role, schema, and emptiness checks in order, all before any write', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ database_name: 'daubert_global', role_name: 'daubert_hub_app' }])
      .mockResolvedValueOnce([{ users_table_exists: true, sessions_table_exists: true }])
      .mockResolvedValueOnce([{ user_count: 0 }]);
    const database = { query };
    await expect(assertProductionBootstrapGuards(database)).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('stops at the first failing guard and never reaches the emptiness check', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ database_name: 'daubert_global', role_name: 'some_other_role' }]);
    const database = { query };
    await expect(assertProductionBootstrapGuards(database)).rejects.toThrow(/expected "daubert_hub_app"/);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('refuses when security.users is non-empty even though every earlier guard passed', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ database_name: 'daubert_global', role_name: 'daubert_hub_app' }])
      .mockResolvedValueOnce([{ users_table_exists: true, sessions_table_exists: true }])
      .mockResolvedValueOnce([{ user_count: 3 }]);
    const database = { query };
    await expect(assertProductionBootstrapGuards(database)).rejects.toThrow(/security\.users is not empty/);
  });
});

describe('createProductionAdmin', () => {
  it('creates ADMIN through the existing UsersService.createUser with the production bootstrap audit context', async () => {
    const createUser = vi.fn().mockResolvedValue(safeUser());
    const result = await createProductionAdmin({ createUser }, { displayName: 'Primer Admin', email: 'admin@daubert.mx', password: 'a-valid-password' });

    expect(createUser).toHaveBeenCalledTimes(1);
    const [input, context] = createUser.mock.calls[0] as [
      { displayName: string; email: string; password: string; role: string },
      { requestId: string; origin: string; actorUserId: string | null; actorUserEmail: string | null }
    ];
    expect(input).toEqual({ displayName: 'Primer Admin', email: 'admin@daubert.mx', password: 'a-valid-password', role: 'ADMIN' });
    expect(context.origin).toBe(PROD_BOOTSTRAP_ORIGIN);
    expect(context.actorUserId).toBeNull();
    expect(context.actorUserEmail).toBeNull();
    expect(context.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.role).toBe('ADMIN');
    expect(result.mustChangePassword).toBe(true);
  });

  it('never sends a pre-hashed password field — only the plaintext, which UsersService itself hashes', async () => {
    const createUser = vi.fn().mockResolvedValue(safeUser());
    await createProductionAdmin({ createUser }, { displayName: 'Primer Admin', email: 'admin@daubert.mx', password: 'a-valid-password' });
    const [input] = createUser.mock.calls[0] as [Record<string, unknown>];
    expect(input).not.toHaveProperty('passwordHash');
    expect(input.password).toBe('a-valid-password');
  });

  it('returns only the safe user representation — no passwordHash field', async () => {
    const createUser = vi.fn().mockResolvedValue(safeUser());
    const result = await createProductionAdmin({ createUser }, { displayName: 'Primer Admin', email: 'admin@daubert.mx', password: 'a-valid-password' });
    expect(result).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(result)).not.toContain('argon2');
  });

  it('never logs the plaintext password, its hash, or any connection detail', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const createUser = vi.fn().mockResolvedValue(safeUser());

    await createProductionAdmin({ createUser }, { displayName: 'Primer Admin', email: 'admin@daubert.mx', password: 'a-very-secret-prod-password' });

    const loggedText = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(' ');
    expect(loggedText).not.toContain('a-very-secret-prod-password');
    expect(loggedText).not.toContain('daubert_hub_app:');
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('propagates a validation/conflict error from UsersService without creating anything', async () => {
    class Boom extends Error {}
    const createUser = vi.fn().mockRejectedValue(new Boom('refused'));
    await expect(createProductionAdmin({ createUser }, { displayName: 'Primer Admin', email: 'admin@daubert.mx', password: 'a-valid-password' })).rejects.toBeInstanceOf(Boom);
  });
});
