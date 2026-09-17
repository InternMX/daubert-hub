import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PasswordPolicyError } from '../src/security/password-policy';
import type { UserRow } from '../src/security/users.types';
import {
  assertLiveDatabaseAndRole,
  assertProductionRecoveryGuards,
  assertSecuritySchemaReady,
  EXPECTED_DATABASE,
  guardedProdDatabaseUrl,
  RECOVERY_ORIGIN,
  recoverProductionAdminPassword,
  RecoveryTargetError
} from '../scripts/reset-admin-password-prod';

const ORIGINAL_ENV = { ...process.env };

function row(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: '9007199254740993123',
    displayName: 'Intern MX',
    email: 'internmx@daubertcromwell.com',
    passwordHash: '$argon2id$old-hash',
    role: 'ADMIN',
    status: 'ACTIVE',
    mustChangePassword: false,
    createdAt: '2026-09-05T10:00:00.000Z',
    updatedAt: '2026-09-05T10:00:00.000Z',
    lastLoginAt: '2026-09-05T09:00:00.000Z',
    ...overrides
  };
}

function fakeDeps(overrides: { findByEmail?: unknown; adminResetPassword?: unknown; hashPassword?: unknown } = {}) {
  const repository = {
    findByEmail: overrides.findByEmail ?? vi.fn().mockResolvedValue(row()),
    adminResetPassword: overrides.adminResetPassword ?? vi.fn().mockResolvedValue(row({ passwordHash: '$argon2id$new-hash', mustChangePassword: true }))
  };
  const passwords = { hashPassword: overrides.hashPassword ?? vi.fn().mockResolvedValue('$argon2id$new-hash') };
  return { repository, passwords } as never as { repository: { findByEmail: ReturnType<typeof vi.fn>; adminResetPassword: ReturnType<typeof vi.fn> }; passwords: { hashPassword: ReturnType<typeof vi.fn> } };
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

  it('rejects daubert_hub_test', () => {
    process.env.PROD_DATABASE_URL = 'postgres://daubert_hub_app:s3cr3t@prod-host:5432/daubert_hub_test';
    expect(() => guardedProdDatabaseUrl()).toThrow(/restricted to daubert_global/);
  });

  it('rejects any other database name', () => {
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

  it('rejects a live database mismatch even when the URL claimed daubert_global', async () => {
    const database = { query: vi.fn().mockResolvedValue([{ database_name: 'daubert_hub_test', role_name: 'daubert_hub_app' }]) };
    await expect(assertLiveDatabaseAndRole(database)).rejects.toThrow(/expected "daubert_global"/);
  });

  it('rejects any current_user other than daubert_hub_app', async () => {
    const database = { query: vi.fn().mockResolvedValue([{ database_name: 'daubert_global', role_name: 'postgres' }]) };
    await expect(assertLiveDatabaseAndRole(database)).rejects.toThrow(/expected "daubert_hub_app"/);
  });
});

describe('assertSecuritySchemaReady', () => {
  it('passes when both security.users and security.sessions exist', async () => {
    const database = { query: vi.fn().mockResolvedValue([{ users_table_exists: true, sessions_table_exists: true }]) };
    await expect(assertSecuritySchemaReady(database)).resolves.toBeUndefined();
  });

  it('rejects missing security schema (security.users absent)', async () => {
    const database = { query: vi.fn().mockResolvedValue([{ users_table_exists: false, sessions_table_exists: true }]) };
    await expect(assertSecuritySchemaReady(database)).rejects.toThrow(/security\.users does not exist/);
  });

  it('rejects missing security schema (security.sessions absent)', async () => {
    const database = { query: vi.fn().mockResolvedValue([{ users_table_exists: true, sessions_table_exists: false }]) };
    await expect(assertSecuritySchemaReady(database)).rejects.toThrow(/security\.sessions does not exist/);
  });
});

describe('assertProductionRecoveryGuards', () => {
  it('runs the database/role check then the schema check, in order, before any write', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ database_name: 'daubert_global', role_name: 'daubert_hub_app' }])
      .mockResolvedValueOnce([{ users_table_exists: true, sessions_table_exists: true }]);
    const database = { query };
    await expect(assertProductionRecoveryGuards(database)).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('stops at the first failing guard and never reaches the schema check', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ database_name: 'daubert_global', role_name: 'some_other_role' }]);
    const database = { query };
    await expect(assertProductionRecoveryGuards(database)).rejects.toThrow(/expected "daubert_hub_app"/);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('recoverProductionAdminPassword', () => {
  it('rejects an unknown email without writing anything', async () => {
    const deps = fakeDeps({ findByEmail: vi.fn().mockResolvedValue(null) });
    await expect(recoverProductionAdminPassword(deps, 'missing@daubertcromwell.com', 'a-valid-new-password')).rejects.toBeInstanceOf(RecoveryTargetError);
    expect(deps.repository.adminResetPassword).not.toHaveBeenCalled();
  });

  it('rejects a target that is not ADMIN, without writing anything', async () => {
    const deps = fakeDeps({ findByEmail: vi.fn().mockResolvedValue(row({ role: 'GENERAL' })) });
    await expect(recoverProductionAdminPassword(deps, 'gen@daubertcromwell.com', 'a-valid-new-password')).rejects.toBeInstanceOf(RecoveryTargetError);
    expect(deps.repository.adminResetPassword).not.toHaveBeenCalled();
  });

  it('enforces the existing password policy before hashing or writing anything', async () => {
    const deps = fakeDeps();
    await expect(recoverProductionAdminPassword(deps, 'internmx@daubertcromwell.com', 'short')).rejects.toBeInstanceOf(PasswordPolicyError);
    expect(deps.passwords.hashPassword).not.toHaveBeenCalled();
    expect(deps.repository.adminResetPassword).not.toHaveBeenCalled();
  });

  it('hashes with PasswordService (Argon2id) and passes only the hash — never the plaintext — to the repository', async () => {
    const deps = fakeDeps();
    await recoverProductionAdminPassword(deps, 'internmx@daubertcromwell.com', 'a-valid-new-password');

    expect(deps.passwords.hashPassword).toHaveBeenCalledWith('a-valid-new-password');
    const [targetId, passwordHash] = deps.repository.adminResetPassword.mock.calls[0] as [string, string];
    expect(targetId).toBe('9007199254740993123');
    expect(passwordHash).toBe('$argon2id$new-hash');
    expect(passwordHash).not.toContain('a-valid-new-password');
  });

  it('uses the atomic adminResetPassword transaction, which requires a password change afterward', async () => {
    const deps = fakeDeps();
    const result = await recoverProductionAdminPassword(deps, 'internmx@daubertcromwell.com', 'a-valid-new-password');
    expect(deps.repository.adminResetPassword).toHaveBeenCalledTimes(1);
    expect(result.mustChangePassword).toBe(true);
  });

  it('revokes existing sessions through the existing adminResetPassword repository behavior (this script never touches security.sessions itself)', async () => {
    const adminResetPassword = vi.fn().mockResolvedValue(row({ passwordHash: '$argon2id$new-hash', mustChangePassword: true }));
    const deps = fakeDeps({ adminResetPassword });
    await recoverProductionAdminPassword(deps, 'internmx@daubertcromwell.com', 'a-valid-new-password');
    // Session revocation is adminResetPassword's own atomic contract (see
    // UsersRepository.adminResetPassword) — this script only calls it, with
    // no separate security.sessions write of its own.
    expect(adminResetPassword).toHaveBeenCalledTimes(1);
  });

  it('never changes role, email, displayName, or status — only delegates the password/session write', async () => {
    const deps = fakeDeps();
    const result = await recoverProductionAdminPassword(deps, 'internmx@daubertcromwell.com', 'a-valid-new-password');
    expect(result.role).toBe('ADMIN');
    expect(result.email).toBe('internmx@daubertcromwell.com');
    expect(result.displayName).toBe('Intern MX');
    expect(result.status).toBe('ACTIVE');
  });

  it('gives the operation the production recovery origin and never attributes it to the target user', async () => {
    const deps = fakeDeps();
    await recoverProductionAdminPassword(deps, 'internmx@daubertcromwell.com', 'a-valid-new-password');

    const [, , context] = deps.repository.adminResetPassword.mock.calls[0] as [string, string, { origin: string; actorUserId: string | null; actorUserEmail: string | null; requestId: string }];
    expect(context.origin).toBe(RECOVERY_ORIGIN);
    expect(context.origin).toBe('DAUBERT_HUB_ADMIN_RECOVERY_PROD');
    expect(context.actorUserId).toBeNull();
    expect(context.actorUserEmail).toBeNull();
    expect(context.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns only the safe user representation — no passwordHash field', async () => {
    const deps = fakeDeps();
    const result = await recoverProductionAdminPassword(deps, 'internmx@daubertcromwell.com', 'a-valid-new-password');
    expect(result).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(result)).not.toContain('argon2');
  });

  it('never logs the plaintext password, the resulting hash, or any connection detail', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const deps = fakeDeps();

    await recoverProductionAdminPassword(deps, 'internmx@daubertcromwell.com', 'a-very-secret-prod-password');

    const loggedText = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(' ');
    expect(loggedText).not.toContain('a-very-secret-prod-password');
    expect(loggedText).not.toContain('$argon2id$new-hash');
    expect(loggedText).not.toContain('daubert_hub_app:');
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('rejects when the target disappears between lookup and the atomic update, without crashing', async () => {
    const deps = fakeDeps({ adminResetPassword: vi.fn().mockResolvedValue(null) });
    await expect(recoverProductionAdminPassword(deps, 'internmx@daubertcromwell.com', 'a-valid-new-password')).rejects.toBeInstanceOf(RecoveryTargetError);
  });

  it('matches the target by normalized email via the repository (lower(btrim(email)) is UsersRepository.findByEmail\'s own contract)', async () => {
    const deps = fakeDeps();
    await recoverProductionAdminPassword(deps, '  InternMX@DaubertCromwell.com  ', 'a-valid-new-password');
    expect(deps.repository.findByEmail).toHaveBeenCalledWith('  InternMX@DaubertCromwell.com  ');
  });
});
