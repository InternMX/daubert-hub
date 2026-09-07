import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { listRecentActivity } from './services/recentActivity';
import { TestAuthProvider } from './test/authTestUtils';

vi.mock('./services/recentActivity', () => ({ listRecentActivity: vi.fn() }));
const activityMock = vi.mocked(listRecentActivity);

function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output>; }
function renderApp(path = '/') {
  return render(<MemoryRouter initialEntries={[path]}><TestAuthProvider><App /><Location /></TestAuthProvider></MemoryRouter>);
}

describe('application navigation', () => {
  beforeEach(() => activityMock.mockResolvedValue([]));
  it.each([['/', 'Inicio'], ['/providers', 'Proveedores'], ['/clients', 'Clientes'], ['/contacts', 'Directorio de contactos'], ['/automations', 'Automatizaciones']])('renders %s', (path, title) => {
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
    expect(screen.getByRole('heading', { level: 1, name: 'Inicio' })).toBeInTheDocument();
  });

  it('opens the new provider flow from providers and home', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('link', { name: 'Nuevo proveedor' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Nuevo proveedor' })).toBeInTheDocument();
  });

  it('enables both Home quick actions and navigates contact creation through the action URL', async () => {
    const user = userEvent.setup();
    renderApp();
    expect(screen.getByRole('link', { name: 'Nuevo proveedor' })).toHaveAttribute('href', '/providers/new');
    const contact = screen.getByRole('link', { name: 'Nuevo contacto' });
    expect(contact).toHaveAttribute('href', '/contacts?action=new-contact');
    await user.click(contact);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/contacts?action=new-contact'));
  });
});

describe('authentication routing', () => {
  beforeEach(() => activityMock.mockResolvedValue([]));

  function renderWithAuth(path: string, authValue: Parameters<typeof TestAuthProvider>[0]['value']) {
    return render(<MemoryRouter initialEntries={[path]}><TestAuthProvider value={authValue}><App /><Location /></TestAuthProvider></MemoryRouter>);
  }

  it('sends an unauthenticated visitor to /login and preserves the requested route', async () => {
    renderWithAuth('/clients/123', { user: null, isLoading: false });
    expect(await screen.findByRole('heading', { name: 'Daubert Hub' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
  });

  it('sends an authenticated visitor away from /login into the application', () => {
    renderWithAuth('/login', { isLoading: false });
    expect(screen.getByRole('heading', { level: 1, name: 'Inicio' })).toBeInTheDocument();
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
