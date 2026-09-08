import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { listRecentActivity } from './services/recentActivity';
import { listUsers } from './services/users';
import { TestAuthProvider, testAdminUser, testGeneralUser } from './test/authTestUtils';
import { ColorModeProvider } from './theme';

vi.mock('./services/recentActivity', () => ({ listRecentActivity: vi.fn() }));
vi.mock('./services/users', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./services/users')>()),
  listUsers: vi.fn()
}));
const activityMock = vi.mocked(listRecentActivity);
const listUsersMock = vi.mocked(listUsers);

function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output>; }
function renderApp(path = '/', user = testAdminUser) {
  return render(<MemoryRouter initialEntries={[path]}><ColorModeProvider><TestAuthProvider value={{ user }}><App /><Location /></TestAuthProvider></ColorModeProvider></MemoryRouter>);
}

describe('application navigation', () => {
  beforeEach(() => activityMock.mockResolvedValue([]));
  it.each([['/', 'Hola, Alejandro López'], ['/providers', 'Proveedores'], ['/clients', 'Clientes'], ['/contacts', 'Directorio de contactos'], ['/automations', 'Automatizaciones']])('renders %s', (path, title) => {
    renderApp(path);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
  });

  it('renders Daubert Cromwell branding and the provider directory', async () => {
    renderApp('/providers');
    expect(screen.getByRole('img', { name: 'Daubert Cromwell' })).toBeInTheDocument();
    expect(screen.getByLabelText('Buscar proveedor')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nuevo proveedor' })).toHaveAttribute('href', '/providers/new');
  });

  it('navigates through every sidebar link', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('link', { name: 'Proveedores' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Proveedores' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Clientes' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Clientes' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Contactos' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Directorio de contactos' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Automatizaciones' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Automatizaciones' })).toBeInTheDocument();
    await user.click(within(screen.getByLabelText('Navegación principal')).getByRole('link', { name: 'Inicio' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Hola, Alejandro López' })).toBeInTheDocument();
  });

  it('opens the new provider flow from providers and home', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('link', { name: 'Nuevo proveedor' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Nuevo proveedor' })).toBeInTheDocument();
  });

  it('exposes all three Home quick-action routes and navigates contact creation through the action URL', async () => {
    const user = userEvent.setup();
    renderApp();
    expect(screen.getByRole('link', { name: 'Nuevo proveedor' })).toHaveAttribute('href', '/providers/new');
    expect(screen.getByRole('link', { name: 'Nuevo cliente' })).toHaveAttribute('href', '/clients/new');
    const contact = screen.getByRole('link', { name: 'Nuevo contacto' });
    expect(contact).toHaveAttribute('href', '/contacts?action=new-contact');
    await user.click(contact);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/contacts?action=new-contact'));
  });

  it('opens the new client flow from Home', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('link', { name: 'Nuevo cliente' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Nuevo cliente' })).toBeInTheDocument();
  });
});

describe('Home operational landing page', () => {
  beforeEach(() => activityMock.mockResolvedValue([]));

  it.each([
    [testAdminUser, 'Hola, Alejandro López', 'Administrador · alejandro@daubertcromwell.com'],
    [testGeneralUser, 'Hola, Ana Ruiz', 'General · ana@daubertcromwell.com']
  ] as const)('shows authenticated identity and operational actions for $user.role', (authenticatedUser, greeting, identity) => {
    renderApp('/', authenticatedUser);
    expect(screen.getByRole('heading', { level: 1, name: greeting })).toBeInTheDocument();
    expect(screen.getByText(identity)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Acciones rápidas' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nuevo proveedor' })).toHaveAttribute('href', '/providers/new');
    expect(screen.getByRole('link', { name: 'Nuevo cliente' })).toHaveAttribute('href', '/clients/new');
    expect(screen.getByRole('link', { name: 'Nuevo contacto' })).toHaveAttribute('href', '/contacts?action=new-contact');
    expect(screen.queryByRole('link', { name: 'Nuevo usuario' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Actividad reciente' })).toBeInTheDocument();
  });

  it('preserves Recent Activity actor presentation on Home', async () => {
    activityMock.mockResolvedValue([{ type: 'PROVIDER_REACTIVATED', category: 'PROVIDER', title: 'Proveedor reactivado', entity: 'ADHECINTAS', context: null, occurredAt: new Date().toISOString(), actor: { id: '9007199254740993', displayName: 'Alejandro López', email: 'alejandro@daubertcromwell.com' } }]);
    renderApp();
    expect(await screen.findByText('Proveedor reactivado')).toBeInTheDocument();
    expect(screen.getByText('ADHECINTAS')).toBeInTheDocument();
    expect(screen.getByText((content) => content.startsWith('Alejandro López · '))).toBeInTheDocument();
    expect(screen.queryByText('9007199254740993')).not.toBeInTheDocument();
    expect(activityMock).toHaveBeenCalledWith(6, undefined);
  });
});

describe('authentication routing', () => {
  beforeEach(() => activityMock.mockResolvedValue([]));

  function renderWithAuth(path: string, authValue: Parameters<typeof TestAuthProvider>[0]['value']) {
    return render(<MemoryRouter initialEntries={[path]}><ColorModeProvider><TestAuthProvider value={authValue}><App /><Location /></TestAuthProvider></ColorModeProvider></MemoryRouter>);
  }

  it('sends an unauthenticated visitor to /login and preserves the requested route', async () => {
    renderWithAuth('/clients/123', { user: null, isLoading: false });
    expect(await screen.findByRole('heading', { name: 'Daubert Hub' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
  });

  it('sends an authenticated visitor away from /login into the application', () => {
    renderWithAuth('/login', { isLoading: false });
    expect(screen.getByRole('heading', { level: 1, name: 'Hola, Alejandro López' })).toBeInTheDocument();
  });

  it('shows a loading state instead of redirecting while auth is still resolving', () => {
    renderWithAuth('/clients', { user: null, isLoading: true });
    expect(screen.queryByRole('heading', { level: 1, name: 'Clientes' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Cargando sesión')).toBeInTheDocument();
  });

  it('routes a user with a pending mandatory password change to /change-password', () => {
    renderWithAuth('/clients', { isLoading: false, user: { id: '1', displayName: 'Alejandro López', email: 'a@daubertcromwell.com', role: 'ADMIN', status: 'ACTIVE', mustChangePassword: true } });
    expect(screen.getByRole('heading', { name: 'Actualiza tu contraseña' })).toBeInTheDocument();
  });
});

describe('admin-only routing (/users)', () => {
  beforeEach(() => {
    listUsersMock.mockResolvedValue([]);
    activityMock.mockResolvedValue([]);
  });

  function renderWithAuth(path: string, authValue: Parameters<typeof TestAuthProvider>[0]['value']) {
    return render(<MemoryRouter initialEntries={[path]}><ColorModeProvider><TestAuthProvider value={authValue}><App /><Location /></TestAuthProvider></ColorModeProvider></MemoryRouter>);
  }

  it('renders /users for an authenticated ADMIN', async () => {
    renderWithAuth('/users', { isLoading: false });
    expect(await screen.findByRole('heading', { level: 1, name: 'Usuarios' })).toBeInTheDocument();
  });

  it('redirects a GENERAL user away from /users to home', () => {
    renderWithAuth('/users', { isLoading: false, user: testGeneralUser });
    expect(screen.getByRole('heading', { level: 1, name: 'Hola, Ana Ruiz' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Usuarios' })).not.toBeInTheDocument();
  });
});
