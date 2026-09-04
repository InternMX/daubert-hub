import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthController } from '../src/security/auth.controller';

const safeUser = { id: '42', displayName: 'Ana', email: 'ana@example.test', role: 'ADMIN', status: 'ACTIVE', mustChangePassword: false, createdAt: 'x', updatedAt: 'x', lastLoginAt: null };

function fakeResponse() {
  return { cookie: vi.fn(), clearCookie: vi.fn() };
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
  it('returns the safe user for a valid session cookie', async () => {
    const auth = { login: vi.fn(), logout: vi.fn(), getUserForToken: vi.fn().mockResolvedValue(safeUser) };
    const controller = new AuthController(auth as never, { secure: false });
    const request = { headers: { cookie: 'daubert_session=raw-token-value' } };

    await expect(controller.me(request as never)).resolves.toEqual({ data: { user: safeUser } });
    expect(auth.getUserForToken).toHaveBeenCalledWith('raw-token-value');
  });

  it('rejects with 401 when there is no session cookie', async () => {
    const auth = { login: vi.fn(), logout: vi.fn(), getUserForToken: vi.fn() };
    const controller = new AuthController(auth as never, { secure: false });
    const request = { headers: {} };

    await expect(controller.me(request as never)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.getUserForToken).not.toHaveBeenCalled();
  });

  it('rejects with 401 when the session cookie does not resolve to an active session', async () => {
    const auth = { login: vi.fn(), logout: vi.fn(), getUserForToken: vi.fn().mockResolvedValue(null) };
    const controller = new AuthController(auth as never, { secure: false });
    const request = { headers: { cookie: 'daubert_session=expired-or-revoked' } };

    await expect(controller.me(request as never)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
