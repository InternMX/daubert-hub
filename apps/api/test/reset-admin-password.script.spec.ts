import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PasswordPolicyError } from '../src/security/password-policy';
import type { UserRow } from '../src/security/users.types';
import {
  assertLiveDatabase,
  guardedTestDatabaseUrl,
  recoverAdminPassword,
  RecoveryTargetError
} from '../scripts/reset-admin-password';

const ORIGINAL_ENV = { ...process.env };

function row(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: '9007199254740993123',
    displayName: 'Ana Admin',
    email: 'ana@example.test',
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
  delete process.env.TEST_DATABASE_URL;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('guardedTestDatabaseUrl', () => {
  it('accepts a TEST_DATABASE_URL pointing exactly at daubert_hub_test', () => {
    process.env.TEST_DATABASE_URL = 'postgres://user:pass@localhost:5432/daubert_hub_test';
    const url = guardedTestDatabaseUrl();
    expect(decodeURIComponent(url.pathname).replace(/^\//, '')).toBe('daubert_hub_test');
  });

  it('rejects any other database name, e.g. daubert_global', () => {
    process.env.TEST_DATABASE_URL = 'postgres://user:pass@localhost:5432/daubert_global';
    expect(() => guardedTestDatabaseUrl()).toThrow(/restricted to daubert_hub_test/);
  });

  it('rejects an unrelated/unknown database name', () => {
    process.env.TEST_DATABASE_URL = 'postgres://user:pass@localhost:5432/some_other_db';
    expect(() => guardedTestDatabaseUrl()).toThrow(/restricted to daubert_hub_test/);
  });

  it('never falls back to DB_* when TEST_DATABASE_URL is unset', () => {
    delete process.env.TEST_DATABASE_URL;
    process.env.DB_HOST = 'localhost';
    process.env.DB_NAME = 'daubert_hub_test';
    process.env.DB_USER = 'someone';
    process.env.DB_PASSWORD = 'secret';
    expect(() => guardedTestDatabaseUrl()).toThrow(/TEST_DATABASE_URL must be set/);
  });

  it('rejects a malformed URL', () => {
    process.env.TEST_DATABASE_URL = 'not-a-valid-url';
    expect(() => guardedTestDatabaseUrl()).toThrow(/valid PostgreSQL URL/);
  });
});

describe('assertLiveDatabase', () => {
  it('passes when the live connection reports daubert_hub_test', async () => {
    const database = { query: vi.fn().mockResolvedValue([{ name: 'daubert_hub_test' }]) };
    await expect(assertLiveDatabase(database as never)).resolves.toBeUndefined();
  });

  it('refuses when the live connection reports a different database', async () => {
    const database = { query: vi.fn().mockResolvedValue([{ name: 'daubert_global' }]) };
    await expect(assertLiveDatabase(database as never)).rejects.toThrow(/expected "daubert_hub_test"/);
  });
});

describe('recoverAdminPassword', () => {
  it('rejects a nonexistent target user without writing anything', async () => {
    const deps = fakeDeps({ findByEmail: vi.fn().mockResolvedValue(null) });
    await expect(recoverAdminPassword(deps, 'missing@example.test', 'a-valid-new-password')).rejects.toBeInstanceOf(RecoveryTargetError);
    expect(deps.repository.adminResetPassword).not.toHaveBeenCalled();
  });

  it('rejects a target that is not ADMIN, without writing anything', async () => {
    const deps = fakeDeps({ findByEmail: vi.fn().mockResolvedValue(row({ role: 'GENERAL' })) });
    await expect(recoverAdminPassword(deps, 'gen@example.test', 'a-valid-new-password')).rejects.toBeInstanceOf(RecoveryTargetError);
    expect(deps.repository.adminResetPassword).not.toHaveBeenCalled();
  });

  it('enforces the existing password policy before hashing or writing anything', async () => {
    const deps = fakeDeps();
    await expect(recoverAdminPassword(deps, 'ana@example.test', 'short')).rejects.toBeInstanceOf(PasswordPolicyError);
    expect(deps.passwords.hashPassword).not.toHaveBeenCalled();
    expect(deps.repository.adminResetPassword).not.toHaveBeenCalled();
  });

  it('does not trim the password before hashing', async () => {
    const deps = fakeDeps();
    await recoverAdminPassword(deps, 'ana@example.test', '  a-valid-new-password  ');
    expect(deps.passwords.hashPassword).toHaveBeenCalledWith('  a-valid-new-password  ');
  });

  it('hashes with PasswordService and passes only the hash (never the plaintext) to the repository', async () => {
    const deps = fakeDeps();
    await recoverAdminPassword(deps, 'ana@example.test', 'a-valid-new-password');

    expect(deps.passwords.hashPassword).toHaveBeenCalledWith('a-valid-new-password');
    const [targetId, passwordHash] = deps.repository.adminResetPassword.mock.calls[0] as [string, string];
    expect(targetId).toBe('9007199254740993123');
    expect(passwordHash).toBe('$argon2id$new-hash');
    expect(passwordHash).not.toContain('a-valid-new-password');
  });

  it('uses the atomic adminResetPassword transaction (mustChangePassword=true + session revocation is that method\'s own contract)', async () => {
    const deps = fakeDeps();
    const result = await recoverAdminPassword(deps, 'ana@example.test', 'a-valid-new-password');
    expect(deps.repository.adminResetPassword).toHaveBeenCalledTimes(1);
    expect(result.mustChangePassword).toBe(true);
  });

  it('never changes role, email, displayName, or status — only delegates the password/session write', async () => {
    const deps = fakeDeps();
    const result = await recoverAdminPassword(deps, 'ana@example.test', 'a-valid-new-password');
    expect(result.role).toBe('ADMIN');
    expect(result.email).toBe('ana@example.test');
    expect(result.displayName).toBe('Ana Admin');
    expect(result.status).toBe('ACTIVE');
  });

  it('gives the operation a non-HTTP recovery origin and never attributes it to the target user', async () => {
    const deps = fakeDeps();
    await recoverAdminPassword(deps, 'ana@example.test', 'a-valid-new-password');

    const [, , context] = deps.repository.adminResetPassword.mock.calls[0] as [string, string, { origin: string; actorUserId: string | null; actorUserEmail: string | null }];
    expect(context.origin).toBe('DAUBERT_HUB_ADMIN_RECOVERY');
    expect(context.actorUserId).toBeNull();
    expect(context.actorUserEmail).toBeNull();
  });

  it('returns only the safe user representation — no passwordHash field', async () => {
    const deps = fakeDeps();
    const result = await recoverAdminPassword(deps, 'ana@example.test', 'a-valid-new-password');
    expect(result).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(result)).not.toContain('argon2');
  });

  it('never logs the plaintext password or the resulting hash', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const deps = fakeDeps();

    await recoverAdminPassword(deps, 'ana@example.test', 'a-very-secret-new-password');

    const loggedText = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(' ');
    expect(loggedText).not.toContain('a-very-secret-new-password');
    expect(loggedText).not.toContain('$argon2id$new-hash');
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('rejects when the target disappears between lookup and the atomic update, without crashing', async () => {
    const deps = fakeDeps({ adminResetPassword: vi.fn().mockResolvedValue(null) });
    await expect(recoverAdminPassword(deps, 'ana@example.test', 'a-valid-new-password')).rejects.toBeInstanceOf(RecoveryTargetError);
  });

  it('matches the target by normalized email via the repository (lower(btrim(email)) is UsersRepository.findByEmail\'s own contract)', async () => {
    const deps = fakeDeps();
    await recoverAdminPassword(deps, '  ANA@Example.Test  ', 'a-valid-new-password');
    expect(deps.repository.findByEmail).toHaveBeenCalledWith('  ANA@Example.Test  ');
  });
});
