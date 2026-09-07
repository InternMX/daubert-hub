import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installSessionInterceptor } from './httpInterceptor';
import { onPasswordChangeRequired, onSessionExpired } from './sessionEvents';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const fetchMock = vi.fn();

// installSessionInterceptor is idempotent and captures whatever window.fetch
// is at install time, so both the stub and the install happen exactly once —
// re-stubbing per test would replace window.fetch with the raw mock again,
// undoing the wrapper without re-triggering a (no-op) re-install.
beforeAll(() => {
  vi.stubGlobal('fetch', fetchMock);
  installSessionInterceptor();
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => fetchMock.mockReset());

describe('installSessionInterceptor', () => {
  it('notifies session expiration on a 401 from a business API call', async () => {
    const listener = vi.fn();
    const unsubscribe = onSessionExpired(listener);
    fetchMock.mockResolvedValue(jsonResponse({ statusCode: 401, message: 'No autenticado.' }, 401));

    await fetch('/api/clients');

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('does not notify session expiration for /api/auth/* responses', async () => {
    const listener = vi.fn();
    const unsubscribe = onSessionExpired(listener);
    fetchMock.mockResolvedValue(jsonResponse({ statusCode: 401, message: 'Correo o contraseña incorrectos.' }, 401));

    await fetch('/api/auth/login', { method: 'POST' });

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('notifies PASSWORD_CHANGE_REQUIRED on a matching 403', async () => {
    const listener = vi.fn();
    const unsubscribe = onPasswordChangeRequired(listener);
    fetchMock.mockResolvedValue(jsonResponse({ statusCode: 403, code: 'PASSWORD_CHANGE_REQUIRED', message: 'Debes cambiar tu contraseña antes de continuar.' }, 403));

    await fetch('/api/clients');
    await Promise.resolve();
    await Promise.resolve();

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('does not notify PASSWORD_CHANGE_REQUIRED for an unrelated 403', async () => {
    const listener = vi.fn();
    const unsubscribe = onPasswordChangeRequired(listener);
    fetchMock.mockResolvedValue(jsonResponse({ statusCode: 403, message: 'No tienes permisos.' }, 403));

    await fetch('/api/clients');
    await Promise.resolve();
    await Promise.resolve();

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('still returns the response body intact to the original caller', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { id: '1' } }));

    const response = await fetch('/api/clients/1');
    const body = await response.json();

    expect(body).toEqual({ data: { id: '1' } });
  });
});
