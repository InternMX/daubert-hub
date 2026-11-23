import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { ProfilePage } from '../account/ProfilePage';
import { AutomationsPage } from '../automations/AutomationsPage';
import { ClientDetailPage } from '../clients/ClientDetailPage';
import { AppShell } from '../components/AppShell';
import { ColorModeProvider } from '../theme';
import { TestAuthProvider, testAdminUser, testGeneralUser } from '../test/authTestUtils';
import { UserDetailPage } from '../users/UserDetailPage';
import { UsersPage } from '../users/UsersPage';
import { useEntornoEmision } from './entornoEmision';
import { marcarManufacturaDisponibleParaPruebas, useManufacturaVisible } from './manufacturaDisponible';
import { RequiereManufactura } from './RequiereManufactura';

const compilado = vi.hoisted(() => ({ visible: true }));
vi.mock('../automations/automationRoutes', async (original) => ({
  ...await original<typeof import('../automations/automationRoutes')>(),
  get MANUFACTURING_UI_VISIBLE() { return compilado.visible; }
}));

const capabilities = vi.fn<(signal?: AbortSignal | null) => Promise<Response>>();
const api = vi.fn(async (url: string, init?: RequestInit) => {
  const path = new URL(url, 'http://localhost').pathname.replace(/^\/api/, '');
  if (path === '/manufacturing-sheets/documents/capabilities') return capabilities(init?.signal);
  if (path === '/automations/overview' || path === '/users') return Response.json({ data: [] });
  if (path === '/users/2') return Response.json({ data: { ...testGeneralUser, createdAt: '2026-01-01', updatedAt: '2026-01-01', lastLoginAt: null } });
  if (path === '/clients/121') return Response.json({ data: { id: '121', commercialName: 'Acme', roles: ['CLIENTE'], status: 'ACTIVO', clientStatus: 'ACTIVO', fiscal: null } });
  if (path.endsWith('/abbreviations')) return Response.json({ disponible: true, puedeResolver: false, data: [], conteos: {} });
  if (path.includes('/signatures')) return Response.json({ data: [], alcance: '' });
  return Response.json({}, { status: 404 });
});

function Navigation() {
  const navigate = useNavigate();
  return <button onClick={() => void navigate('/automations/manufacturing-sheets')}>Abrir ruta</button>;
}

function renderApp(path: string, navigate = false) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ColorModeProvider><TestAuthProvider><App /></TestAuthProvider></ColorModeProvider>
      {navigate && <Navigation />}
    </MemoryRouter>
  );
}

function renderConsumers() {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={['/121/2']}>
        <ColorModeProvider>
          <TestAuthProvider>
            <AppShell>
              <AutomationsPage />
              <ProfilePage />
              <UsersPage />
              <Routes>
                <Route path="/:clientId/:userId" element={<><ClientDetailPage /><UserDetailPage /></>} />
              </Routes>
              <RequiereManufactura><div>Página protegida</div></RequiereManufactura>
            </AppShell>
          </TestAuthProvider>
        </ColorModeProvider>
      </MemoryRouter>
    </StrictMode>
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar automatizaciones' }));
  return within(screen.getByRole('menu'));
}

function expectSurfacesHidden() {
  expect(screen.queryByTestId('assisted-process-card')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Mis firmas' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Abreviaturas de código DCMX' })).toBeNull();
  expect(screen.queryByText('Firmas de personas sin cuenta')).toBeNull();
  expect(screen.queryByTestId('firmas-admin')).toBeNull();
}

function expectNoOtherManufacturingRequest() {
  const requests = api.mock.calls.map(([url]) => url).filter((url) =>
    /manufacturing-sheets|bind|abbreviations|signatures/i.test(url)
    && !url.endsWith('/documents/capabilities'));
  expect(requests).toEqual([]);
}

const unavailable = 'Hojas de manufactura no está disponible en este momento.';

beforeEach(() => {
  marcarManufacturaDisponibleParaPruebas(false);
  compilado.visible = true;
  capabilities.mockReset();
  api.mockClear();
  vi.stubGlobal('fetch', api);
});

afterEach(() => vi.unstubAllGlobals());

describe('Manufactura runtime availability', () => {
  it('shares a pending probe across menu, card and route and displays all surfaces after a valid 200', async () => {
    let respond!: (response: Response) => void;
    capabilities.mockImplementationOnce(() => new Promise((resolve) => { respond = resolve; }));
    // The existing signature components independently read the firmas capability after mounting.
    capabilities.mockImplementation(async () => Response.json({ firmas: true, entorno: 'PRODUCCION' }));
    renderConsumers();
    const menu = openMenu();
    expect(menu.queryByRole('menuitem', { name: 'Hojas de manufactura' })).toBeNull();
    expectSurfacesHidden();
    expect(screen.queryByText('Página protegida')).toBeNull();
    await waitFor(() => expect(capabilities).toHaveBeenCalledTimes(1));
    expectNoOtherManufacturingRequest();

    await act(async () => respond(Response.json({ firmas: true, entorno: 'PRODUCCION' })));
    expect(menu.getByRole('menuitem', { name: 'Hojas de manufactura' })).toBeInTheDocument();
    fireEvent.keyDown(menu.getByRole('menuitem', { name: 'Hojas de manufactura' }), { key: 'Escape' });
    expect(await screen.findByTestId('assisted-process-card')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Mis firmas' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Abreviaturas de código DCMX' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Firmas de personas sin cuenta' })).toBeInTheDocument();
    expect(await screen.findByTestId('firmas-admin')).toBeInTheDocument();
    expect(screen.getByText('Página protegida')).toBeInTheDocument();
    const entorno = renderHook(() => useEntornoEmision());
    expect(entorno.result.current.texto).toBe('PRODUCCIÓN');
  });

  it.each([404, 401, 500, 'network', 'invalid body', 'abort'])('hides all surfaces after %s', async (failure) => {
    capabilities.mockImplementation(async () => {
      if (failure === 'network') throw new TypeError('Failed to fetch');
      if (failure === 'abort') throw new DOMException('Aborted', 'AbortError');
      return typeof failure === 'number'
        ? Response.json({}, { status: failure })
        : Response.json({ firmas: true, entorno: 'INVALID' });
    });
    renderConsumers();
    expect(await screen.findByText(unavailable)).toBeInTheDocument();
    expectSurfacesHidden();
    expect(openMenu().queryByRole('menuitem', { name: 'Hojas de manufactura' })).toBeNull();
    expect(capabilities).toHaveBeenCalledTimes(1);
    expectNoOtherManufacturingRequest();
  });

  it.each([
    '/automations/manufacturing-sheets',
    '/automations/manufacturing-sheets/settings',
    '/client-abbreviations',
    '/users/signatures'
  ])('blocks direct navigation to %s while pending and after a 404', async (path) => {
    let respond!: (response: Response) => void;
    capabilities.mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    renderApp(path);
    expect(screen.getByRole('progressbar', { name: 'Cargando' })).toBeInTheDocument();
    await waitFor(() => expect(capabilities).toHaveBeenCalledTimes(1));
    expectNoOtherManufacturingRequest();
    await act(async () => respond(Response.json({}, { status: 404 })));
    expect(screen.getByText(unavailable)).toBeInTheDocument();
    expect(within(screen.getByText(unavailable).parentElement!).getByRole('link', { name: 'Inicio' })).toHaveAttribute('href', '/');
    expectNoOtherManufacturingRequest();
  });

  it('revalidates before mounting a route after a 200 from the shell', async () => {
    capabilities.mockImplementationOnce(async () => Response.json({ firmas: false }));
    capabilities.mockImplementationOnce(async () => Response.json({}, { status: 404 }));
    renderApp('/automations', true);
    expect(await screen.findByTestId('assisted-process-card')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir ruta' }));
    expect(await screen.findByText(unavailable)).toBeInTheDocument();
    expect(capabilities).toHaveBeenCalledTimes(2);
    expectNoOtherManufacturingRequest();
  });

  it('clears availability on logout and fails closed for a different user', async () => {
    capabilities.mockImplementationOnce(async () => Response.json({ firmas: false }));
    capabilities.mockImplementationOnce(async () => Response.json({}, { status: 404 }));
    function View({ user }: { user: typeof testAdminUser | null }) {
      return <TestAuthProvider value={{ user }}><Availability /></TestAuthProvider>;
    }
    function Availability() {
      const { estado } = useManufacturaVisible();
      return <output>{estado}</output>;
    }
    const view = render(<View user={null} />);
    expect(capabilities).not.toHaveBeenCalled();
    view.rerender(<View user={testAdminUser} />);
    expect(await screen.findByText('disponible')).toBeInTheDocument();
    view.rerender(<View user={null} />);
    expect(screen.getByText('desconocido')).toBeInTheDocument();
    expect(capabilities).toHaveBeenCalledTimes(1);
    view.rerender(<View user={testGeneralUser} />);
    expect(screen.getByText('desconocido')).toBeInTheDocument();
    expect(await screen.findByText('no-disponible')).toBeInTheDocument();
    expect(capabilities).toHaveBeenCalledTimes(2);
  });

  it('aborts when the last consumer unmounts and ignores the stale success', async () => {
    let respond!: (response: Response) => void;
    capabilities.mockImplementationOnce(() => new Promise((resolve) => { respond = resolve; }));
    capabilities.mockImplementationOnce(async () => Response.json({}, { status: 404 }));
    const view = renderHook(() => useManufacturaVisible(), { wrapper: TestAuthProvider });
    expect(view.result.current.estado).toBe('desconocido');
    await waitFor(() => expect(capabilities).toHaveBeenCalledTimes(1));
    const signal = capabilities.mock.calls[0]?.[0];
    view.unmount();
    await act(async () => respond(Response.json({ firmas: true, entorno: 'PRODUCCION' })));
    expect(signal?.aborted).toBe(true);
    const next = renderHook(() => ({ availability: useManufacturaVisible(), environment: useEntornoEmision() }), { wrapper: TestAuthProvider });
    expect(next.result.current.availability.estado).toBe('desconocido');
    await waitFor(() => expect(next.result.current.availability.estado).toBe('no-disponible'));
    expect(next.result.current.environment.texto).toBe('PRUEBA');
  });

  it('renders no Manufactura surfaces and never probes with the compile-time flag off', async () => {
    compilado.visible = false;
    renderApp('/automations');
    await waitFor(() => expect(api).toHaveBeenCalledWith(expect.stringContaining('/automations/overview')));
    expectSurfacesHidden();
    expect(openMenu().queryByRole('menuitem', { name: 'Hojas de manufactura' })).toBeNull();
    expect(capabilities).not.toHaveBeenCalled();
  });
});
