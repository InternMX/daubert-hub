import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthController } from '../src/security/auth.controller';
import { AuthService } from '../src/security/auth.service';
import { CsrfOriginGuard } from '../src/security/csrf-origin.guard';
import { LoginRateLimiterService } from '../src/security/login-rate-limiter.service';

// Proves the real request pipeline's composition: CsrfOriginGuard (as
// registered globally, first, in app.module.ts) runs before AuthController/
// AuthService for POST /api/auth/login, so a rejected cross-site attempt
// never reaches Argon2 verification or rate-limit bookkeeping. This wires
// the REAL CsrfOriginGuard and REAL AuthController/AuthService/
// LoginRateLimiterService classes directly (the same manual-construction
// pattern already used by auth.controller.spec.ts/auth.service.spec.ts),
// rather than through Nest's TestingModule DI container + HTTP transport —
// see csrf-origin.e2e.spec.ts for the generic, DI-driven proof that Nest's
// guard pipeline itself rejects before any handler runs, for an arbitrary
// route.
function fakeExecutionContext(method: string, headers: Record<string, string | undefined>): ExecutionContext {
  const request = { method, headers };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

function fakeResponse() {
  return { cookie: vi.fn(), clearCookie: vi.fn() };
}

function setup() {
  const users = { findForAuthentication: vi.fn().mockResolvedValue(null), recordSuccessfulLogin: vi.fn(), findById: vi.fn(), findCredentialsById: vi.fn(), createUser: vi.fn(), updatePassword: vi.fn() };
  const passwords = { verifyPassword: vi.fn().mockResolvedValue(false), hashPassword: vi.fn() };
  const sessions = { createSession: vi.fn(), resolveActiveSession: vi.fn(), revokeByToken: vi.fn(), revokeAllForUser: vi.fn() };
  const loginRateLimiter = new LoginRateLimiterService();
  const authService = new AuthService(users as never, passwords as never, sessions as never, loginRateLimiter);
  const controller = new AuthController(authService, { secure: false });
  const guard = new CsrfOriginGuard();

  // Mirrors exactly what the real pipeline does: the guard runs first; only
  // if it doesn't throw does the controller (and therefore AuthService,
  // Argon2, the rate limiter) ever get invoked.
  async function handleLoginRequest(headers: Record<string, string | undefined>, body: { email: string; password: string }) {
    guard.canActivate(fakeExecutionContext('POST', headers));
    return controller.login(body, fakeResponse() as never);
  }

  return { handleLoginRequest, users, passwords, sessions, loginRateLimiter };
}

describe('CsrfOriginGuard + real AuthController/AuthService composition', () => {
  it('a foreign-Origin login attempt is rejected 403 before Argon2 or rate-limit bookkeeping ever runs', async () => {
    const { handleLoginRequest, users, passwords } = setup();

    await expect(
      handleLoginRequest({ host: 'app.example.test', origin: 'https://evil.example' }, { email: 'victim@example.test', password: 'guessed-password' })
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(users.findForAuthentication).not.toHaveBeenCalled();
    expect(passwords.verifyPassword).not.toHaveBeenCalled();
  });

  it('a Sec-Fetch-Site: cross-site login attempt is rejected 403 before Argon2 or rate-limit bookkeeping ever runs', async () => {
    const { handleLoginRequest, passwords } = setup();

    await expect(
      handleLoginRequest({ host: 'app.example.test', 'sec-fetch-site': 'cross-site' }, { email: 'victim@example.test', password: 'guessed-password' })
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(passwords.verifyPassword).not.toHaveBeenCalled();
  });

  it('repeated cross-site login attempts against the same email never advance that email toward the rate limit', async () => {
    const { handleLoginRequest, passwords } = setup();

    for (let i = 0; i < 25; i++) {
      await expect(
        handleLoginRequest({ host: 'app.example.test', origin: 'https://evil.example' }, { email: 'victim@example.test', password: 'guessed-password' })
      ).rejects.toBeInstanceOf(ForbiddenException);
    }

    // If those 25 cross-site attempts had incremented the limiter, the very
    // next same-origin attempt would already be 429. It must instead reach
    // Argon2 and receive the ordinary generic 401 (unknown email, dummy hash).
    await expect(
      handleLoginRequest({ host: 'app.example.test', origin: 'https://app.example.test' }, { email: 'victim@example.test', password: 'still-wrong' })
    ).rejects.toMatchObject({ message: 'Correo o contraseña incorrectos.' });
    expect(passwords.verifyPassword).toHaveBeenCalledTimes(1);
  });

  it('a same-origin login with valid credentials still succeeds normally', async () => {
    const { handleLoginRequest, users, passwords, sessions } = setup();
    const row = {
      id: '42',
      displayName: 'Ana',
      email: 'ana@example.test',
      passwordHash: '$argon2id$stored',
      role: 'ADMIN',
      status: 'ACTIVE',
      mustChangePassword: false,
      createdAt: 'x',
      updatedAt: 'x',
      lastLoginAt: null
    };
    users.findForAuthentication.mockResolvedValue(row);
    passwords.verifyPassword.mockResolvedValue(true);
    sessions.createSession.mockResolvedValue({ token: 'raw-token', expiresAt: new Date() });
    users.recordSuccessfulLogin.mockResolvedValue(row);

    const result = await handleLoginRequest({ host: 'app.example.test', origin: 'https://app.example.test' }, { email: 'ana@example.test', password: 'correct-password' });

    expect(result.data.user.email).toBe('ana@example.test');
  });

  it('a login with neither Origin nor Sec-Fetch-Site (non-browser client) still reaches Argon2 and gets the ordinary generic 401', async () => {
    const { handleLoginRequest, passwords } = setup();

    await expect(handleLoginRequest({ host: 'app.example.test' }, { email: 'someone@example.test', password: 'wrong' })).rejects.toMatchObject({
      message: 'Correo o contraseña incorrectos.'
    });
    expect(passwords.verifyPassword).toHaveBeenCalledTimes(1);
  });

  it('a rate-limited (429) login still surfaces as 429, unaffected by the CSRF layer, once the real threshold is hit same-origin', async () => {
    const { handleLoginRequest } = setup();
    const headers = { host: 'app.example.test', origin: 'https://app.example.test' };

    for (let i = 0; i < 10; i++) {
      await expect(handleLoginRequest(headers, { email: 'ana@example.test', password: 'wrong' })).rejects.toMatchObject({ message: 'Correo o contraseña incorrectos.' });
    }

    const eleventh = await handleLoginRequest(headers, { email: 'ana@example.test', password: 'wrong' }).catch((error: unknown) => error);
    expect((eleventh as { getStatus: () => number }).getStatus()).toBe(429);
  });
});
