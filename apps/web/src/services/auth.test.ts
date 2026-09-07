import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError, changePassword, getCurrentUser, login, logout } from './auth';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const safeUser = { id: '1', displayName: 'Alejandro López', email: 'alejandro@daubertcromwell.com', role: 'ADMIN' as const, status: 'ACTIVE' as const, mustChangePassword: false };

afterEach(() => vi.unstubAllGlobals());

describe('auth service', () => {
  it('logs in and returns the safe user', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { user: safeUser } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(login('alejandro@daubertcromwell.com', 'a-valid-password')).resolves.toEqual(safeUser);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST' }));
  });

  it('throws AuthApiError with status 401 on invalid credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ statusCode: 401, message: 'Correo o contraseña incorrectos.' }, 401)));

    await expect(login('a@b.com', 'wrong')).rejects.toMatchObject({ status: 401 });
  });

  it('reads the current user from /auth/me', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { user: safeUser } })));
    await expect(getCurrentUser()).resolves.toEqual(safeUser);
  });

  it('surfaces a 401 AuthApiError for unauthenticated hydration', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ statusCode: 401, message: 'No autenticado.' }, 401)));
    await expect(getCurrentUser()).rejects.toBeInstanceOf(AuthApiError);
  });

  it('surfaces a network failure as status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(getCurrentUser()).rejects.toMatchObject({ status: 0 });
  });

  it('surfaces a server error distinctly from a 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ statusCode: 500, message: 'Error interno del servidor.' }, 500)));
    await expect(getCurrentUser()).rejects.toMatchObject({ status: 500 });
  });

  it('logs out without throwing even when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(logout()).resolves.toBeUndefined();
  });

  it('changes the password and returns the updated safe user', async () => {
    const updated = { ...safeUser, mustChangePassword: false };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { user: updated } })));
    await expect(changePassword('current', 'a-new-long-password')).resolves.toEqual(updated);
  });

  it('surfaces the backend message when the current password is wrong', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ statusCode: 401, message: 'La contraseña actual no es correcta.' }, 401)));
    await expect(changePassword('wrong', 'a-new-long-password')).rejects.toMatchObject({ status: 401, message: 'La contraseña actual no es correcta.' });
  });
});
