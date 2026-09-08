import { HttpException, UnauthorizedException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../src/security/auth.service';
import { LoginRateLimiterService } from '../src/security/login-rate-limiter.service';
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
  const users = { findForAuthentication: vi.fn(), recordSuccessfulLogin: vi.fn(), findById: vi.fn(), findCredentialsById: vi.fn(), createUser: vi.fn(), updatePassword: vi.fn() };
  const passwords = { verifyPassword: vi.fn(), hashPassword: vi.fn() };
  const sessions = { createSession: vi.fn(), resolveActiveSession: vi.fn(), revokeByToken: vi.fn(), revokeAllForUser: vi.fn() };
  // A permissive stub by default — most tests here are not exercising rate
  // limiting, so assertNotBlocked never throws unless a test opts in.
  const loginRateLimiter = { assertNotBlocked: vi.fn(), recordFailure: vi.fn(), recordSuccess: vi.fn() };
  const service = new AuthService(users as never, passwords as never, sessions as never, loginRateLimiter as never);
  return { service, users, passwords, sessions, loginRateLimiter };
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

  it('checks the rate limiter before touching credentials, using the normalized email as the key', async () => {
    const { service, users, passwords, loginRateLimiter } = setup();
    users.findForAuthentication.mockResolvedValue(null);
    passwords.verifyPassword.mockResolvedValue(false);

    await service.login('  Ana@Example.TEST  ', 'x').catch(() => undefined);

    expect(loginRateLimiter.assertNotBlocked).toHaveBeenCalledWith('ana@example.test');
  });

  it('propagates the rate limiter 429 as-is, without ever calling findForAuthentication', async () => {
    const { service, users, loginRateLimiter } = setup();
    const blocked = new HttpException({ code: 'LOGIN_RATE_LIMITED', message: 'Demasiados intentos de inicio de sesión. Intenta nuevamente más tarde.' }, 429);
    loginRateLimiter.assertNotBlocked.mockImplementation(() => { throw blocked; });

    await expect(service.login('ana@example.test', 'x')).rejects.toBe(blocked);
    expect(users.findForAuthentication).not.toHaveBeenCalled();
  });

  it('records a failure on wrong password, unknown email, and inactive user alike — outward behavior stays equivalent', async () => {
    const { service, users, passwords, loginRateLimiter } = setup();

    users.findForAuthentication.mockResolvedValue(null);
    passwords.verifyPassword.mockResolvedValue(false);
    await service.login('missing@example.test', 'x').catch(() => undefined);
    expect(loginRateLimiter.recordFailure).toHaveBeenCalledWith('missing@example.test');

    users.findForAuthentication.mockResolvedValue(userRow());
    passwords.verifyPassword.mockResolvedValue(false);
    await service.login('ana@example.test', 'x').catch(() => undefined);
    expect(loginRateLimiter.recordFailure).toHaveBeenCalledWith('ana@example.test');

    users.findForAuthentication.mockResolvedValue(userRow({ status: 'INACTIVE' }));
    passwords.verifyPassword.mockResolvedValue(true);
    await service.login('ana@example.test', 'x').catch(() => undefined);
    expect(loginRateLimiter.recordFailure).toHaveBeenCalledTimes(3);
  });

  it('records a success and never a failure when login succeeds', async () => {
    const { service, users, passwords, sessions, loginRateLimiter } = setup();
    const row = userRow();
    users.findForAuthentication.mockResolvedValue(row);
    passwords.verifyPassword.mockResolvedValue(true);
    sessions.createSession.mockResolvedValue({ token: 'raw-token-value', expiresAt: new Date() });
    users.recordSuccessfulLogin.mockResolvedValue(row);

    await service.login(' ANA@Example.test ', 'correct-password');

    expect(loginRateLimiter.recordSuccess).toHaveBeenCalledWith('ana@example.test');
    expect(loginRateLimiter.recordFailure).not.toHaveBeenCalled();
  });
});

describe('AuthService.login rate limiting (using the real LoginRateLimiterService)', () => {
  function setupWithRealLimiter() {
    const users = { findForAuthentication: vi.fn(), recordSuccessfulLogin: vi.fn(), findById: vi.fn(), findCredentialsById: vi.fn(), createUser: vi.fn(), updatePassword: vi.fn() };
    const passwords = { verifyPassword: vi.fn(), hashPassword: vi.fn() };
    const sessions = { createSession: vi.fn(), resolveActiveSession: vi.fn(), revokeByToken: vi.fn(), revokeAllForUser: vi.fn() };
    const loginRateLimiter = new LoginRateLimiterService();
    const service = new AuthService(users as never, passwords as never, sessions as never, loginRateLimiter);
    return { service, users, passwords, sessions, loginRateLimiter };
  }

  it('permits 10 failed attempts, then rejects the 11th with 429 LOGIN_RATE_LIMITED', async () => {
    const { service, users, passwords } = setupWithRealLimiter();
    users.findForAuthentication.mockResolvedValue(null);
    passwords.verifyPassword.mockResolvedValue(false);

    for (let i = 0; i < 10; i++) {
      await expect(service.login('ana@example.test', 'wrong')).rejects.toBeInstanceOf(UnauthorizedException);
    }

    const eleventh = await service.login('ana@example.test', 'wrong').catch((error: unknown) => error);
    expect(eleventh).toBeInstanceOf(HttpException);
    expect((eleventh as HttpException).getStatus()).toBe(429);
    expect((eleventh as HttpException).getResponse()).toMatchObject({ code: 'LOGIN_RATE_LIMITED' });
  });

  it('a successful login resets the counter so a later failing streak starts from zero again', async () => {
    const { service, users, passwords, sessions } = setupWithRealLimiter();
    users.findForAuthentication.mockResolvedValue(userRow());
    passwords.verifyPassword.mockResolvedValue(false);
    for (let i = 0; i < 9; i++) await service.login('ana@example.test', 'wrong').catch(() => undefined);

    passwords.verifyPassword.mockResolvedValue(true);
    sessions.createSession.mockResolvedValue({ token: 't', expiresAt: new Date() });
    users.recordSuccessfulLogin.mockResolvedValue(userRow());
    await expect(service.login('ana@example.test', 'correct')).resolves.toBeDefined();

    passwords.verifyPassword.mockResolvedValue(false);
    // Back to 0 failures — 9 more wrong attempts must still not be blocked.
    for (let i = 0; i < 9; i++) {
      await expect(service.login('ana@example.test', 'wrong')).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });

  it('normalizes email case and surrounding whitespace to the same bookkeeping key', async () => {
    const { service, users, passwords } = setupWithRealLimiter();
    users.findForAuthentication.mockResolvedValue(null);
    passwords.verifyPassword.mockResolvedValue(false);

    for (let i = 0; i < 10; i++) await service.login(' Ana@Example.Test ', 'wrong').catch(() => undefined);

    // Same account, different casing/whitespace — must already be blocked.
    const blocked = await service.login('ANA@EXAMPLE.TEST', 'wrong').catch((error: unknown) => error);
    expect(blocked).toBeInstanceOf(HttpException);
    expect((blocked as HttpException).getStatus()).toBe(429);
  });

  it('keeps failure counters isolated per normalized email', async () => {
    const { service, users, passwords } = setupWithRealLimiter();
    users.findForAuthentication.mockResolvedValue(null);
    passwords.verifyPassword.mockResolvedValue(false);

    for (let i = 0; i < 10; i++) await service.login('victim-a@example.test', 'wrong').catch(() => undefined);
    const blockedA = await service.login('victim-a@example.test', 'wrong').catch((error: unknown) => error);
    expect((blockedA as HttpException).getStatus()).toBe(429);

    // A different account is unaffected — still gets the ordinary 401.
    await expect(service.login('victim-b@example.test', 'wrong')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  describe('cooldown-with-probes (fixes the account-targeted DoS from unconditional post-threshold blocking)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    });

    afterEach(() => vi.useRealTimers());

    it('an attacker hammering a known email after the threshold cannot trigger unlimited Argon2 work: verifyPassword is not called again while blocked', async () => {
      const { service, users, passwords } = setupWithRealLimiter();
      users.findForAuthentication.mockResolvedValue(userRow());
      passwords.verifyPassword.mockResolvedValue(false);

      for (let i = 0; i < 10; i++) await service.login('ana@example.test', 'wrong').catch(() => undefined);
      passwords.verifyPassword.mockClear();

      for (let i = 0; i < 25; i++) {
        const error = await service.login('ana@example.test', 'wrong').catch((caught: unknown) => caught);
        expect((error as HttpException).getStatus()).toBe(429);
      }
      // 25 more attempts, zero more Argon2 calls — the whole point of cooldown.
      expect(passwords.verifyPassword).not.toHaveBeenCalled();
    });

    it('the legitimate account owner gets a bounded verification opportunity roughly once a minute even while an attacker keeps the account under attack', async () => {
      const { service, users, passwords, sessions } = setupWithRealLimiter();
      const row = userRow();
      users.findForAuthentication.mockResolvedValue(row);
      passwords.verifyPassword.mockResolvedValue(false);
      for (let i = 0; i < 10; i++) await service.login('ana@example.test', 'wrong').catch(() => undefined);

      // Attacker keeps hammering immediately — all rejected, no Argon2.
      const stillBlocked = await service.login('ana@example.test', 'wrong').catch((error: unknown) => error);
      expect((stillBlocked as HttpException).getStatus()).toBe(429);

      // A minute later, the legitimate owner tries their real password —
      // this is the bounded recovery opportunity, and it must reach Argon2.
      vi.advanceTimersByTime(60_000);
      passwords.verifyPassword.mockResolvedValue(true);
      sessions.createSession.mockResolvedValue({ token: 'raw-token', expiresAt: new Date() });
      users.recordSuccessfulLogin.mockResolvedValue(row);

      const result = await service.login('ana@example.test', 'the-real-password');
      expect(result.token).toBe('raw-token');
      expect(passwords.verifyPassword).toHaveBeenLastCalledWith(row.passwordHash, 'the-real-password');

      // Success cleared the limiter entirely — a fresh 10-failure allowance
      // is available again, proving full recovery.
      passwords.verifyPassword.mockResolvedValue(false);
      for (let i = 0; i < 10; i++) {
        await expect(service.login('ana@example.test', 'wrong')).rejects.toBeInstanceOf(UnauthorizedException);
      }
    });

    it('an unknown email under sustained attack gets the exact same 429/Retry-After treatment as a real one — still no account-existence signal', async () => {
      const { service: unknownService, users: unknownUsers, passwords: unknownPasswords } = setupWithRealLimiter();
      unknownUsers.findForAuthentication.mockResolvedValue(null);
      unknownPasswords.verifyPassword.mockResolvedValue(false);

      const { service: knownService, users: knownUsers, passwords: knownPasswords } = setupWithRealLimiter();
      knownUsers.findForAuthentication.mockResolvedValue(userRow());
      knownPasswords.verifyPassword.mockResolvedValue(false);

      for (let i = 0; i < 10; i++) {
        await unknownService.login('missing@example.test', 'wrong').catch(() => undefined);
        await knownService.login('ana@example.test', 'wrong').catch(() => undefined);
      }

      const unknownBlocked = await unknownService.login('missing@example.test', 'wrong').catch((error: unknown) => error);
      const knownBlocked = await knownService.login('ana@example.test', 'wrong').catch((error: unknown) => error);

      expect((unknownBlocked as HttpException).getResponse()).toEqual((knownBlocked as HttpException).getResponse());
      expect((unknownBlocked as HttpException).getStatus()).toBe((knownBlocked as HttpException).getStatus());
    });
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

describe('AuthService.changePassword', () => {
  const identity = { userId: '9007199254740993123', userEmail: 'ana@example.test' };

  it('verifies the current password, hashes and persists the new one, and clears mustChangePassword', async () => {
    const { service, users, passwords } = setup();
    const row = userRow({ passwordHash: '$argon2id$current-hash' });
    users.findCredentialsById.mockResolvedValue(row);
    passwords.verifyPassword.mockResolvedValue(true);
    users.updatePassword.mockResolvedValue({ id: row.id, mustChangePassword: false });

    const result = await service.changePassword(row.id, 'the-current-password', 'a-brand-new-password', identity);

    expect(users.findCredentialsById).toHaveBeenCalledWith(row.id);
    expect(passwords.verifyPassword).toHaveBeenCalledWith(row.passwordHash, 'the-current-password');
    expect(users.updatePassword).toHaveBeenCalledWith(row.id, 'a-brand-new-password', false, expect.objectContaining({ actorUserId: identity.userId, actorUserEmail: identity.userEmail }));
    expect(result).toEqual({ id: row.id, mustChangePassword: false });
  });

  it('rejects with a generic 401 when the current password is wrong, without persisting anything', async () => {
    const { service, users, passwords } = setup();
    const row = userRow();
    users.findCredentialsById.mockResolvedValue(row);
    passwords.verifyPassword.mockResolvedValue(false);

    await expect(service.changePassword(row.id, 'wrong-current-password', 'a-brand-new-password', identity)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.updatePassword).not.toHaveBeenCalled();
  });

  it('rejects when the new password is identical to the current password, without persisting anything', async () => {
    const { service, users, passwords } = setup();
    const row = userRow();
    users.findCredentialsById.mockResolvedValue(row);
    passwords.verifyPassword.mockResolvedValue(true);

    await expect(service.changePassword(row.id, 'same-password-value', 'same-password-value', identity)).rejects.toMatchObject({ status: 400 });
    expect(users.updatePassword).not.toHaveBeenCalled();
  });

  it('maps a password-policy violation on the new password to a 400', async () => {
    const { PasswordPolicyError } = await import('../src/security/password-policy');
    const { service, users, passwords } = setup();
    const row = userRow();
    users.findCredentialsById.mockResolvedValue(row);
    passwords.verifyPassword.mockResolvedValue(true);
    users.updatePassword.mockRejectedValue(new PasswordPolicyError('La contraseña debe tener al menos 12 caracteres.'));

    await expect(service.changePassword(row.id, 'the-current-password', 'short', identity)).rejects.toMatchObject({ status: 400 });
  });
});
