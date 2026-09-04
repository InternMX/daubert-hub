import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../src/security/auth.service';
import type { UserRow } from '../src/security/users.types';

function userRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: '9007199254740993123',
    displayName: 'Ana Admin',
    email: 'ana@example.test',
    passwordHash: '$argon2id$stored-real-hash',
    role: 'ADMIN',
    status: 'ACTIVE',
    mustChangePassword: false,
    createdAt: '2026-09-05T10:00:00.000Z',
    updatedAt: '2026-09-05T10:00:00.000Z',
    lastLoginAt: null,
    ...overrides
  };
}

function setup() {
  const users = { findForAuthentication: vi.fn(), recordSuccessfulLogin: vi.fn(), findById: vi.fn(), createUser: vi.fn(), updatePassword: vi.fn() };
  const passwords = { verifyPassword: vi.fn(), hashPassword: vi.fn() };
  const sessions = { createSession: vi.fn(), resolveActiveSession: vi.fn(), revokeByToken: vi.fn(), revokeAllForUser: vi.fn() };
  const service = new AuthService(users as never, passwords as never, sessions as never);
  return { service, users, passwords, sessions };
}

describe('AuthService.login', () => {
  it('succeeds with valid credentials: creates a session, records last_login_at, and returns the safe user + raw token', async () => {
    const { service, users, passwords, sessions } = setup();
    const row = userRow();
    users.findForAuthentication.mockResolvedValue(row);
    passwords.verifyPassword.mockResolvedValue(true);
    sessions.createSession.mockResolvedValue({ token: 'raw-token-value', expiresAt: new Date() });
    users.recordSuccessfulLogin.mockResolvedValue({ id: row.id, displayName: row.displayName, email: row.email, role: row.role, status: row.status, mustChangePassword: row.mustChangePassword, createdAt: row.createdAt, updatedAt: row.updatedAt, lastLoginAt: '2026-09-05T12:00:00.000Z' });

    const result = await service.login('ana@example.test', 'correct-password');

    expect(passwords.verifyPassword).toHaveBeenCalledWith(row.passwordHash, 'correct-password');
    expect(sessions.createSession).toHaveBeenCalledWith(row.id);
    expect(users.recordSuccessfulLogin).toHaveBeenCalledWith(row.id, expect.objectContaining({ origin: 'DAUBERT_HUB', actorUserId: row.id, actorUserEmail: row.email }));
    expect(result.token).toBe('raw-token-value');
    expect(result.user.lastLoginAt).toBe('2026-09-05T12:00:00.000Z');
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('never sends the raw session token to the repository layer as a request id', async () => {
    const { service, users, passwords, sessions } = setup();
    const row = userRow();
    users.findForAuthentication.mockResolvedValue(row);
    passwords.verifyPassword.mockResolvedValue(true);
    sessions.createSession.mockResolvedValue({ token: 'the-raw-session-token', expiresAt: new Date() });
    users.recordSuccessfulLogin.mockResolvedValue(row);

    await service.login('ana@example.test', 'correct-password');

    const context = users.recordSuccessfulLogin.mock.calls[0]?.[1];
    expect(context.requestId).not.toBe('the-raw-session-token');
  });

  it('rejects a wrong password with the generic error, without creating a session', async () => {
    const { service, users, passwords, sessions } = setup();
    users.findForAuthentication.mockResolvedValue(userRow());
    passwords.verifyPassword.mockResolvedValue(false);

    await expect(service.login('ana@example.test', 'wrong-password')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.login('ana@example.test', 'wrong-password')).rejects.toMatchObject({ message: 'Correo o contraseña incorrectos.' });
    expect(sessions.createSession).not.toHaveBeenCalled();
  });

  it('rejects an unknown email with the same generic error, still calling verifyPassword against a dummy hash', async () => {
    const { service, users, passwords, sessions } = setup();
    users.findForAuthentication.mockResolvedValue(null);
    passwords.verifyPassword.mockResolvedValue(false);

    await expect(service.login('missing@example.test', 'anything')).rejects.toMatchObject({ message: 'Correo o contraseña incorrectos.' });
    expect(passwords.verifyPassword).toHaveBeenCalledTimes(1);
    expect(passwords.verifyPassword.mock.calls[0]?.[0]).toMatch(/^\$argon2id\$/);
    expect(sessions.createSession).not.toHaveBeenCalled();
  });

  it('rejects an inactive user with the same generic error, even with the correct password', async () => {
    const { service, users, passwords, sessions } = setup();
    users.findForAuthentication.mockResolvedValue(userRow({ status: 'INACTIVE' }));
    passwords.verifyPassword.mockResolvedValue(true);

    await expect(service.login('ana@example.test', 'correct-password')).rejects.toMatchObject({ message: 'Correo o contraseña incorrectos.' });
    expect(sessions.createSession).not.toHaveBeenCalled();
  });

  it('produces the exact same error message/type across all three invalid paths', async () => {
    const { service, users, passwords } = setup();

    users.findForAuthentication.mockResolvedValue(null);
    passwords.verifyPassword.mockResolvedValue(false);
    const unknownEmail = await service.login('missing@example.test', 'x').catch((error: unknown) => error);

    users.findForAuthentication.mockResolvedValue(userRow());
    passwords.verifyPassword.mockResolvedValue(false);
    const wrongPassword = await service.login('ana@example.test', 'x').catch((error: unknown) => error);

    users.findForAuthentication.mockResolvedValue(userRow({ status: 'INACTIVE' }));
    passwords.verifyPassword.mockResolvedValue(true);
    const inactiveUser = await service.login('ana@example.test', 'x').catch((error: unknown) => error);

    for (const error of [unknownEmail, wrongPassword, inactiveUser]) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getStatus()).toBe(401);
      expect((error as Error).message).toBe('Correo o contraseña incorrectos.');
    }
  });
});

describe('AuthService.logout', () => {
  it('delegates to sessions.revokeByToken', async () => {
    const { service, sessions } = setup();
    await service.logout('raw-token');
    expect(sessions.revokeByToken).toHaveBeenCalledWith('raw-token');
  });
});

describe('AuthService.getUserForToken', () => {
  it('returns the safe user for an active session', async () => {
    const { service, sessions } = setup();
    sessions.resolveActiveSession.mockResolvedValue({ sessionId: '1', user: { id: '42' } });
    await expect(service.getUserForToken('raw-token')).resolves.toEqual({ id: '42' });
  });

  it('returns null when the session does not resolve', async () => {
    const { service, sessions } = setup();
    sessions.resolveActiveSession.mockResolvedValue(null);
    await expect(service.getUserForToken('raw-token')).resolves.toBeNull();
  });
});
