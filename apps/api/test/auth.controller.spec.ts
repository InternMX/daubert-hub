import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthController } from '../src/security/auth.controller';

const safeUser = { id: '42', displayName: 'Ana', email: 'ana@example.test', role: 'ADMIN', status: 'ACTIVE', mustChangePassword: false, createdAt: 'x', updatedAt: 'x', lastLoginAt: null };

function fakeResponse() {
  return { cookie: vi.fn(), clearCookie: vi.fn() };
}

function fakeAuth() {
  return { login: vi.fn(), logout: vi.fn(), getUserForToken: vi.fn(), changePassword: vi.fn() };
}

describe('AuthController.login', () => {
  it('returns only the safe user, sets the session cookie, and never exposes the token in the body', async () => {
    const auth = { login: vi.fn().mockResolvedValue({ user: safeUser, token: 'raw-token-value' }), logout: vi.fn(), getUserForToken: vi.fn() };
    const controller = new AuthController(auth as never, { secure: false });
    const response = fakeResponse();

    const result = await controller.login({ email: 'ana@example.test', password: 'a-password' }, response as never);

    expect(auth.login).toHaveBeenCalledWith('ana@example.test', 'a-password');
    expect(result).toEqual({ data: { user: safeUser } });
    expect(JSON.stringify(result)).not.toContain('raw-token-value');
    expect(response.cookie).toHaveBeenCalledWith('daubert_session', 'raw-token-value', expect.objectContaining({ httpOnly: true, sameSite: 'strict', path: '/api' }));
  });
});

describe('AuthController.logout', () => {
  it('revokes the session found in the cookie and always clears the cookie', async () => {
    const auth = { login: vi.fn(), logout: vi.fn(), getUserForToken: vi.fn() };
    const controller = new AuthController(auth as never, { secure: false });
    const request = { headers: { cookie: 'daubert_session=raw-token-value' } };
    const response = fakeResponse();

    const result = await controller.logout(request as never, response as never);

    expect(auth.logout).toHaveBeenCalledWith('raw-token-value');
    expect(response.clearCookie).toHaveBeenCalledWith('daubert_session', expect.objectContaining({ path: '/api' }));
    expect(result).toEqual({ data: { success: true } });
  });

  it('still clears the cookie and succeeds when there is no session cookie at all', async () => {
    const auth = { login: vi.fn(), logout: vi.fn(), getUserForToken: vi.fn() };
    const controller = new AuthController(auth as never, { secure: false });
    const request = { headers: {} };
    const response = fakeResponse();

    const result = await controller.logout(request as never, response as never);

    expect(auth.logout).not.toHaveBeenCalled();
    expect(response.clearCookie).toHaveBeenCalledOnce();
    expect(result).toEqual({ data: { success: true } });
  });
});

describe('AuthController.me', () => {
  // AuthGuard already resolved and attached request.user before the handler
  // runs — me() must use it directly rather than re-authenticating the
  // cookie a second time (Phase 3's getUserForToken is not called here).
  it('returns request.user as attached by AuthGuard, without re-authenticating', () => {
    const auth = { login: vi.fn(), logout: vi.fn(), getUserForToken: vi.fn() };
    const controller = new AuthController(auth as never, { secure: false });
    const request = { headers: {}, user: safeUser };

    expect(controller.me(request as never)).toEqual({ data: { user: safeUser } });
    expect(auth.getUserForToken).not.toHaveBeenCalled();
  });

  it('rejects with 401 when request.user is unset (defensive: AuthGuard should already have rejected)', () => {
    const auth = { login: vi.fn(), logout: vi.fn(), getUserForToken: vi.fn() };
    const controller = new AuthController(auth as never, { secure: false });
    const request = { headers: {} };

    expect(() => controller.me(request as never)).toThrow(UnauthorizedException);
  });
});

describe('AuthController.changePassword', () => {
  it('extracts identity from request.user and returns only the safe user', async () => {
    const auth = fakeAuth();
    auth.changePassword.mockResolvedValue(safeUser);
    const controller = new AuthController(auth as never, { secure: false });
    const request = { headers: {}, user: safeUser };

    const result = await controller.changePassword({ currentPassword: 'old-password-value', newPassword: 'new-password-value' }, request as never);

    expect(auth.changePassword).toHaveBeenCalledWith(safeUser.id, 'old-password-value', 'new-password-value', { userId: safeUser.id, userEmail: safeUser.email });
    expect(result).toEqual({ data: { user: safeUser } });
    expect(JSON.stringify(result)).not.toContain('old-password-value');
    expect(JSON.stringify(result)).not.toContain('new-password-value');
  });

  it('rejects with 401 when request.user is unset (defensive)', async () => {
    const auth = fakeAuth();
    const controller = new AuthController(auth as never, { secure: false });
    const request = { headers: {} };

    await expect(controller.changePassword({ currentPassword: 'x', newPassword: 'y' }, request as never)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.changePassword).not.toHaveBeenCalled();
  });
});
