import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { getDocumentSeries } from './services/automations';
import { listAutomationsOverview, type AutomationOverview } from './services/automationsOverview';
import { listAudiExecutions } from './services/audiExecutions';
import { listCaterpillarExecutions, listCaterpillarSeries } from './services/caterpillarRemissions';
import { listPaymentNotificationExecutions } from './services/paymentNotifications';
import { listRecentActivity } from './services/recentActivity';
import { listUsers } from './services/users';
import { TestAuthProvider, testAdminUser, testGeneralUser } from './test/authTestUtils';
import { ColorModeProvider } from './theme';

vi.mock('./services/recentActivity', () => ({ listRecentActivity: vi.fn() }));
vi.mock('./services/users', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./services/users')>()),
  listUsers: vi.fn()
}));
vi.mock('./services/paymentNotifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./services/paymentNotifications')>()),
  listPaymentNotificationExecutions: vi.fn()
}));
vi.mock('./services/automationsOverview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./services/automationsOverview')>()),
  listAutomationsOverview: vi.fn()
}));
vi.mock('./services/automations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./services/automations')>()),
  getDocumentSeries: vi.fn()
}));
vi.mock('./services/audiExecutions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./services/audiExecutions')>()),
  listAudiExecutions: vi.fn()
}));
vi.mock('./services/caterpillarRemissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./services/caterpillarRemissions')>()),
  listCaterpillarSeries: vi.fn(),
  listCaterpillarExecutions: vi.fn()
}));
const activityMock = vi.mocked(listRecentActivity);
const listUsersMock = vi.mocked(listUsers);
const paymentNotificationsMock = vi.mocked(listPaymentNotificationExecutions);
const automationsOverviewMock = vi.mocked(listAutomationsOverview);
const getDocumentSeriesMock = vi.mocked(getDocumentSeries);
const audiExecutionsMock = vi.mocked(listAudiExecutions);
const caterpillarSeriesMock = vi.mocked(listCaterpillarSeries);
const caterpillarExecutionsMock = vi.mocked(listCaterpillarExecutions);

function automationOverview(overrides: Partial<AutomationOverview> = {}): AutomationOverview {
  return {
    code: 'PAYMENT_NOTIFICATIONS',
    name: 'Notificaciones de pago',
    description: 'Revisa periódicamente nuevas notificaciones de pago.',
    integrationStatus: 'INTEGRATED',
    environment: 'TEST',
    lifecycleStatus: null,
    polling: { intervalMinutes: 5, label: 'Cada 5 minutos' },
    lastCheckAt: null,
    lastProcessing: null,
    nextCheckAt: null,
    capabilities: { hasDashboard: true, hasHistory: true, hasDetail: true },
    review: { required: false, problemOccurredAt: null, problemOutcome: null },
    ...overrides
  };
}

function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output>; }
function renderApp(path = '/', user = testAdminUser) {
  return render(<MemoryRouter initialEntries={[path]}><ColorModeProvider><TestAuthProvider value={{ user }}><App /><Location /></TestAuthProvider></ColorModeProvider></MemoryRouter>);
}

describe('application navigation', () => {
  beforeEach(() => { activityMock.mockResolvedValue([]); automationsOverviewMock.mockResolvedValue([]); });
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
  beforeEach(() => { activityMock.mockResolvedValue([]); automationsOverviewMock.mockResolvedValue([]); });

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
  beforeEach(() => { activityMock.mockResolvedValue([]); automationsOverviewMock.mockResolvedValue([]); });

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

describe('Payment Notifications navigation', () => {
  beforeEach(() => {
    activityMock.mockResolvedValue([]);
    automationsOverviewMock.mockResolvedValue([]);
    paymentNotificationsMock.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } });
  });

  it('exposes a Notificaciones de pago entry from the Automations page (no new sidebar section)', async () => {
    const user = userEvent.setup();
    automationsOverviewMock.mockResolvedValue([automationOverview()]);
    renderApp('/automations');
    expect(screen.getByRole('heading', { level: 1, name: 'Automatizaciones' })).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: 'Ver automatización' });
    expect(link).toHaveAttribute('href', '/automations/payment-notifications');
    await user.click(link);
    expect(await screen.findByRole('heading', { level: 1, name: 'Notificaciones de pago' })).toBeInTheDocument();
  });

  it('renders the dashboard route directly', async () => {
    renderApp('/automations/payment-notifications');
    expect(await screen.findByRole('heading', { level: 1, name: 'Notificaciones de pago' })).toBeInTheDocument();
  });

  it.each([
    ['ADMIN', testAdminUser],
    ['GENERAL', testGeneralUser]
  ] as const)('renders the exact same dashboard for %s', async (_role, user) => {
    renderApp('/automations/payment-notifications', user);
    expect(await screen.findByText('Aún no hay ejecuciones registradas.')).toBeInTheDocument();
  });
});

describe('Automations overview navigation', () => {
  beforeEach(() => {
    activityMock.mockResolvedValue([]);
    automationsOverviewMock.mockResolvedValue([
      automationOverview({ code: 'REMISIONES_AUDI', name: 'Remisiones Audi', description: 'Generación y control de remisiones.', lifecycleStatus: 'ACTIVE', polling: { intervalMinutes: 10, label: 'Cada 10 minutos' } }),
      automationOverview(),
      automationOverview({ code: 'REMISIONES_CATERPILLAR', name: 'Remisiones Caterpillar', description: 'Generación y control de remisiones para Caterpillar.', integrationStatus: 'NOT_INTEGRATED', polling: { intervalMinutes: 15, label: 'Cada 15 minutos' }, capabilities: { hasDashboard: false, hasHistory: false, hasDetail: false } })
    ]);
    getDocumentSeriesMock.mockResolvedValue({
      automation: { code: 'REMISIONES_AUDI', name: 'Remisiones Audi', status: 'ACTIVO' },
      series: { code: 'REMISION_AUDI', name: 'Remisión Audi', nextFolio: 9007, status: 'ACTIVO' },
      adjustments: []
    });
    audiExecutionsMock.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } });
  });

  it('renders one card per automation and routes Audi/Payment Notifications to their dashboards', async () => {
    const user = userEvent.setup();
    renderApp('/automations');
    expect(await screen.findByText('Remisiones Audi')).toBeInTheDocument();
    expect(screen.getByText('Notificaciones de pago')).toBeInTheDocument();
    expect(screen.getByText('Remisiones Caterpillar')).toBeInTheDocument();

    const links = screen.getAllByRole('link', { name: 'Ver automatización' });
    expect(links).toHaveLength(2);
    const audiLink = links.find((link) => link.getAttribute('href') === '/automations/remissions/audi')!;
    await user.click(audiLink);
    expect(await screen.findByRole('heading', { level: 1, name: 'Remisiones Audi' })).toBeInTheDocument();
  });

  it('never renders a "Ver automatización" action for Caterpillar while hasDashboard is false', async () => {
    renderApp('/automations');
    await screen.findByText('Remisiones Caterpillar');
    expect(screen.getAllByRole('link', { name: 'Ver automatización' })).toHaveLength(2);
  });

  it.each([
    ['ADMIN', testAdminUser],
    ['GENERAL', testGeneralUser]
  ] as const)('renders the same Remisiones Audi dashboard for %s, but folio adjustment stays ADMIN-only (Phase 12B.2 §F)', async (role, user) => {
    renderApp('/automations/remissions/audi', user);
    expect(await screen.findByRole('heading', { level: 1, name: 'Remisiones Audi' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Estado operacional' })).toBeInTheDocument();
    if (role === 'ADMIN') {
      expect(screen.getByRole('button', { name: 'Editar próximo folio' })).toBeInTheDocument();
    } else {
      expect(screen.queryByRole('button', { name: 'Editar próximo folio' })).not.toBeInTheDocument();
    }
  });
});

// Phase 12A.4b: the real production catalog state after P5/P6 validation (2026-09-22) —
// integrationStatus INTEGRATED, automation.estatus still independently INACTIVA (PostgreSQL truth
// is read separately and must never be inferred from integrationStatus).
describe('Caterpillar navigation (Phase 12A.4b)', () => {
  beforeEach(() => {
    activityMock.mockResolvedValue([]);
    automationsOverviewMock.mockResolvedValue([
      automationOverview({
        code: 'REMISIONES_CATERPILLAR', name: 'Remisiones Caterpillar', description: 'Generación y control de remisiones para Caterpillar.',
        integrationStatus: 'INTEGRATED', lifecycleStatus: 'INACTIVE', lastProcessing: null,
        polling: { intervalMinutes: 15, label: 'Cada 15 minutos' },
        capabilities: { hasDashboard: true, hasHistory: true, hasDetail: true }
      })
    ]);
    caterpillarSeriesMock.mockResolvedValue({ data: [] });
    caterpillarExecutionsMock.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } });
  });

  it('navigates from /automations to the Caterpillar dashboard via Ver automatización', async () => {
    const user = userEvent.setup();
    renderApp('/automations');
    const link = await screen.findByRole('link', { name: 'Ver automatización' });
    expect(link).toHaveAttribute('href', '/automations/remissions/caterpillar');
    await user.click(link);
    expect(await screen.findByRole('heading', { level: 1, name: 'Remisiones Caterpillar' })).toBeInTheDocument();
  });

  it('renders the dashboard route directly, with no preparation banner and an independent INACTIVA automation status', async () => {
    renderApp('/automations/remissions/caterpillar');
    expect(await screen.findByRole('heading', { level: 1, name: 'Remisiones Caterpillar' })).toBeInTheDocument();
    expect(screen.queryByText('Pendiente de validación operacional con el primer archivo productivo.')).not.toBeInTheDocument();
    expect(await screen.findByText('Inactiva')).toBeInTheDocument();
  });

  it.each([
    ['ADMIN', testAdminUser],
    ['GENERAL', testGeneralUser]
  ] as const)('renders the exact same Caterpillar dashboard for %s', async (_role, user) => {
    renderApp('/automations/remissions/caterpillar', user);
    expect(await screen.findByRole('heading', { level: 1, name: 'Remisiones Caterpillar' })).toBeInTheDocument();
    expect(await screen.findByText('No hay ejecuciones de Caterpillar registradas.')).toBeInTheDocument();
  });
});

describe('admin-only routing (/users)', () => {
  beforeEach(() => {
    listUsersMock.mockResolvedValue([]);
    activityMock.mockResolvedValue([]);
    automationsOverviewMock.mockResolvedValue([]);
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
