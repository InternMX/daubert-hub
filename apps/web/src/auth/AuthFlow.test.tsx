import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { getRuntimeEnvironment } from '../services/health';
import { listClients } from '../services/clients';
import { listRecentActivity } from '../services/recentActivity';
import { AuthProvider } from './AuthContext';

vi.mock('../services/health', () => ({ getRuntimeEnvironment: vi.fn() }));
vi.mock('../services/recentActivity', () => ({ listRecentActivity: vi.fn() }));
vi.mock('../services/clients', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/clients')>()),
  listClients: vi.fn()
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const adminUser = { id: '1', displayName: 'Alejandro López', email: 'alejandro@daubertcromwell.com', role: 'ADMIN', status: 'ACTIVE', mustChangePassword: false };
const mustChangeUser = { ...adminUser, mustChangePassword: true };

function renderApp(path = '/') {
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}

beforeEach(() => {
  vi.mocked(getRuntimeEnvironment).mockResolvedValue('TEST');
  vi.mocked(listRecentActivity).mockResolvedValue([]);
  vi.mocked(listClients).mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 1 } });
});

afterEach(() => vi.unstubAllGlobals());

describe('AuthProvider hydration', () => {
  it('shows a loading state before /auth/me resolves', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<never>(() => undefined)));
    renderApp('/');
    expect(screen.getByLabelText('Cargando sesión')).toBeInTheDocument();
  });

  it('renders the application when /auth/me succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { user: adminUser } })));
    renderApp('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Inicio' })).toBeInTheDocument();
  });

  it('shows the login page without an alarming error when /auth/me returns 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ statusCode: 401, message: 'No autenticado.' }, 401)));
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Daubert Hub' })).toBeInTheDocument();
    expect(screen.queryByText(/no se pudo verificar/i)).not.toBeInTheDocument();
  });

  it('surfaces a distinct notice on the login page when /auth/me fails as a service/server error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ statusCode: 500, message: 'Error interno del servidor.' }, 500)));
    renderApp('/');
    expect(await screen.findByText(/no se pudo verificar tu sesión/i)).toBeInTheDocument();
  });
});

describe('login flow', () => {
  it('redirects an unauthenticated visitor to /login and back to the originally requested route after login', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return Promise.resolve(jsonResponse({ statusCode: 401, message: 'No autenticado.' }, 401));
      if (url.endsWith('/auth/login')) return Promise.resolve(jsonResponse({ data: { user: adminUser } }));
      return Promise.resolve(jsonResponse({ data: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApp('/automations');
    await screen.findByRole('heading', { name: 'Daubert Hub' });

    await user.type(screen.getByLabelText('Correo electrónico'), 'alejandro@daubertcromwell.com');
    await user.type(screen.getByLabelText('Contraseña'), 'a-valid-password');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Automatizaciones' })).toBeInTheDocument();
  });

  it('shows a fixed Spanish message for invalid credentials without revealing the cause', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return Promise.resolve(jsonResponse({ statusCode: 401, message: 'No autenticado.' }, 401));
      if (url.endsWith('/auth/login')) return Promise.resolve(jsonResponse({ statusCode: 401, message: 'Correo o contraseña incorrectos.', code: undefined }, 401));
      return Promise.resolve(jsonResponse({ data: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApp('/login');
    await screen.findByRole('heading', { name: 'Daubert Hub' });
    await user.type(screen.getByLabelText('Correo electrónico'), 'someone@daubertcromwell.com');
    await user.type(screen.getByLabelText('Contraseña'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findByText('Correo o contraseña incorrectos.')).toBeInTheDocument();
  });

  it('disables the submit button while a login request is pending, preventing duplicate submissions', async () => {
    const user = userEvent.setup();
    let resolveLogin: (value: Response) => void = () => undefined;
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return Promise.resolve(jsonResponse({ statusCode: 401, message: 'No autenticado.' }, 401));
      if (url.endsWith('/auth/login')) return new Promise<Response>((resolve) => { resolveLogin = resolve; });
      return Promise.resolve(jsonResponse({ data: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApp('/login');
    await screen.findByRole('heading', { name: 'Daubert Hub' });
    await user.type(screen.getByLabelText('Correo electrónico'), 'alejandro@daubertcromwell.com');
    await user.type(screen.getByLabelText('Contraseña'), 'a-valid-password');
    const button = screen.getByRole('button', { name: 'Iniciar sesión' });
    await user.click(button);

    expect(button).toBeDisabled();
    const loginCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/auth/login'));
    expect(loginCalls).toHaveLength(1);

    resolveLogin(jsonResponse({ data: { user: adminUser } }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Inicio' })).toBeInTheDocument());
  });

  it('sends a user with a pending mandatory password change to /change-password after login', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return Promise.resolve(jsonResponse({ statusCode: 401, message: 'No autenticado.' }, 401));
      if (url.endsWith('/auth/login')) return Promise.resolve(jsonResponse({ data: { user: mustChangeUser } }));
      return Promise.resolve(jsonResponse({ data: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApp('/login');
    await screen.findByRole('heading', { name: 'Daubert Hub' });
    await user.type(screen.getByLabelText('Correo electrónico'), 'alejandro@daubertcromwell.com');
    await user.type(screen.getByLabelText('Contraseña'), 'a-valid-password');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findByRole('heading', { name: 'Actualiza tu contraseña' })).toBeInTheDocument();
  });
});

describe('mandatory password change', () => {
  it('blocks normal application routes while mustChangePassword is true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { user: mustChangeUser } })));
    renderApp('/clients');
    expect(await screen.findByRole('heading', { name: 'Actualiza tu contraseña' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Clientes' })).not.toBeInTheDocument();
  });

  it('validates minimum length and matching confirmation before submitting', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { user: mustChangeUser } })));
    renderApp('/change-password');
    await screen.findByRole('heading', { name: 'Actualiza tu contraseña' });

    await user.type(screen.getByLabelText('Contraseña actual'), 'current-password');
    await user.type(screen.getByLabelText('Nueva contraseña'), 'short');
    await user.type(screen.getByLabelText('Confirmar nueva contraseña'), 'different');
    await user.click(screen.getByRole('button', { name: 'Guardar nueva contraseña' }));

    expect(screen.getByText(/al menos 12 caracteres/i)).toBeInTheDocument();
    expect(screen.getByText('Las contraseñas no coinciden.')).toBeInTheDocument();
  });

  it('updates the session and returns to the application after a successful change', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return Promise.resolve(jsonResponse({ data: { user: mustChangeUser } }));
      if (url.endsWith('/auth/change-password')) return Promise.resolve(jsonResponse({ data: { user: adminUser } }));
      return Promise.resolve(jsonResponse({ data: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApp('/change-password');
    await screen.findByRole('heading', { name: 'Actualiza tu contraseña' });

    await user.type(screen.getByLabelText('Contraseña actual'), 'current-password');
    await user.type(screen.getByLabelText('Nueva contraseña'), 'a-new-long-password');
    await user.type(screen.getByLabelText('Confirmar nueva contraseña'), 'a-new-long-password');
    await user.click(screen.getByRole('button', { name: 'Guardar nueva contraseña' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Inicio' })).toBeInTheDocument();
  });

  // /auth/* calls are exempt from the global session-expiry interceptor
  // (httpInterceptor.ts) because they carry their own error semantics — but a
  // 401 from /auth/change-password is ambiguous: it means either "wrong
  // current password" (session still valid) or "session expired/revoked"
  // (indistinguishable by status code alone). Either way, the frontend must
  // never keep showing an authenticated change-password form against a
  // session the backend has already rejected.
  it('clears the session and returns to /login when the session expires mid change-password', async () => {
    const user = userEvent.setup();
    let meCallCount = 0;
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) {
        meCallCount += 1;
        // First hydration succeeds; once the session is revoked mid-flow, any
        // subsequent /auth/me also reports unauthenticated.
        return Promise.resolve(meCallCount === 1 ? jsonResponse({ data: { user: mustChangeUser } }) : jsonResponse({ statusCode: 401, message: 'No autenticado.' }, 401));
      }
      if (url.endsWith('/auth/change-password')) return Promise.resolve(jsonResponse({ statusCode: 401, message: 'No autenticado.' }, 401));
      return Promise.resolve(jsonResponse({ data: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApp('/change-password');
    await screen.findByRole('heading', { name: 'Actualiza tu contraseña' });

    await user.type(screen.getByLabelText('Contraseña actual'), 'current-password');
    await user.type(screen.getByLabelText('Nueva contraseña'), 'a-new-long-password');
    await user.type(screen.getByLabelText('Confirmar nueva contraseña'), 'a-new-long-password');
    await user.click(screen.getByRole('button', { name: 'Guardar nueva contraseña' }));

    expect(await screen.findByRole('heading', { name: 'Daubert Hub' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Actualiza tu contraseña' })).not.toBeInTheDocument();
  });

  it('keeps the session and the form when the 401 is just a wrong current password', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      // /auth/me keeps reporting the same still-valid, still-must-change session.
      if (url.endsWith('/auth/me')) return Promise.resolve(jsonResponse({ data: { user: mustChangeUser } }));
      if (url.endsWith('/auth/change-password')) return Promise.resolve(jsonResponse({ statusCode: 401, message: 'La contraseña actual no es correcta.' }, 401));
      return Promise.resolve(jsonResponse({ data: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApp('/change-password');
    await screen.findByRole('heading', { name: 'Actualiza tu contraseña' });

    await user.type(screen.getByLabelText('Contraseña actual'), 'wrong-password');
    await user.type(screen.getByLabelText('Nueva contraseña'), 'a-new-long-password');
    await user.type(screen.getByLabelText('Confirmar nueva contraseña'), 'a-new-long-password');
    await user.click(screen.getByRole('button', { name: 'Guardar nueva contraseña' }));

    expect(await screen.findByText('La contraseña actual no es correcta.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Actualiza tu contraseña' })).toBeInTheDocument();
  });
});

describe('logout', () => {
  it('clears the session and redirects to /login', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return Promise.resolve(jsonResponse({ data: { user: adminUser } }));
      if (url.endsWith('/auth/logout')) return Promise.resolve(jsonResponse({ data: { success: true } }));
      return Promise.resolve(jsonResponse({ data: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Inicio' });
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    expect(await screen.findByRole('heading', { name: 'Daubert Hub' })).toBeInTheDocument();
  });
});
