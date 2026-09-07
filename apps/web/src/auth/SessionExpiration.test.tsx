import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { getRuntimeEnvironment } from '../services/health';
import { installSessionInterceptor } from '../services/httpInterceptor';
import { AuthProvider } from './AuthContext';

// These tests exercise the real global-fetch interceptor (services/httpInterceptor.ts)
// together with AuthProvider and real, unmocked services/clients — proving that a
// business API call, not just /auth/*, drives session-expiration/PASSWORD_CHANGE_REQUIRED
// handling end to end.
vi.mock('../services/health', () => ({ getRuntimeEnvironment: vi.fn() }));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const adminUser = { id: '1', displayName: 'Alejandro López', email: 'alejandro@daubertcromwell.com', role: 'ADMIN', status: 'ACTIVE', mustChangePassword: false };
const fetchMock = vi.fn();

beforeAll(() => {
  vi.stubGlobal('fetch', fetchMock);
  installSessionInterceptor();
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(getRuntimeEnvironment).mockResolvedValue('TEST');
});

function renderApp(path = '/clients') {
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}

describe('session expiration via a business API call', () => {
  it('transitions to unauthenticated and /login when a protected request returns 401 mid-session', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return Promise.resolve(jsonResponse({ data: { user: adminUser } }));
      if (url.includes('/clients')) return Promise.resolve(jsonResponse({ statusCode: 401, message: 'No autenticado.' }, 401));
      return Promise.resolve(jsonResponse({ data: [] }));
    });

    renderApp('/clients');

    expect(await screen.findByRole('heading', { name: 'Daubert Hub' })).toBeInTheDocument();
  });
});

describe('PASSWORD_CHANGE_REQUIRED via a business API call', () => {
  it('routes to /change-password when a protected request returns 403 PASSWORD_CHANGE_REQUIRED', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return Promise.resolve(jsonResponse({ data: { user: adminUser } }));
      if (url.includes('/clients')) return Promise.resolve(jsonResponse({ statusCode: 403, code: 'PASSWORD_CHANGE_REQUIRED', message: 'Debes cambiar tu contraseña antes de continuar.' }, 403));
      return Promise.resolve(jsonResponse({ data: [] }));
    });

    renderApp('/clients');

    expect(await screen.findByRole('heading', { name: 'Actualiza tu contraseña' })).toBeInTheDocument();
  });
});
