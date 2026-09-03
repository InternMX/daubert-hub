import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRuntimeEnvironment, type RuntimeEnvironment } from '../services/health';
import { AppShell } from './AppShell';

vi.mock('../services/health', () => ({ getRuntimeEnvironment: vi.fn() }));

function mockWideViewport(initiallyWide: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQuery = {
    matches: initiallyWide,
    media: '(min-width:1200px)',
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeListener: (listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    dispatchEvent: () => true
  } as MediaQueryList;
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mediaQuery));
  return (wide: boolean) => {
    Object.defineProperty(mediaQuery, 'matches', { configurable: true, value: wide });
    act(() => listeners.forEach((listener) => listener({ matches: wide, media: mediaQuery.media } as MediaQueryListEvent)));
  };
}

function renderShell(path = '/') {
  return render(<MemoryRouter initialEntries={[path]}><AppShell><Routes>
    <Route path="/" element={<div>Inicio page</div>} />
    <Route path="/providers" element={<div>Providers page</div>} />
    <Route path="/clients" element={<div>Clients page</div>} />
    <Route path="/contacts" element={<div>Contacts page</div>} />
    <Route path="/automations" element={<div>Automations page</div>} />
  </Routes></AppShell></MemoryRouter>);
}

function shell() { return screen.getByTestId('app-shell'); }

beforeEach(() => {
  localStorage.clear();
  document.title = 'Daubert Hub';
  vi.mocked(getRuntimeEnvironment).mockReset();
  vi.mocked(getRuntimeEnvironment).mockImplementation(() => new Promise<never>(() => undefined));
});
afterEach(() => { localStorage.clear(); document.title = 'Daubert Hub'; vi.unstubAllGlobals(); });

describe('AppShell sidebar', () => {
  it('uses a neutral loading indicator without assuming an environment', () => {
    mockWideViewport(true);

    renderShell();

    expect(screen.getByText('CARGANDO…')).toBeInTheDocument();
    expect(screen.queryByText('PRUEBAS')).not.toBeInTheDocument();
    expect(screen.queryByText('PRODUCCIÓN')).not.toBeInTheDocument();
    expect(document.title).toBe('Daubert Hub');
  });

  it.each([
    ['PRODUCTION', 'PRODUCCIÓN', 'Daubert Hub · PROD'],
    ['TEST', 'PRUEBAS', 'Daubert Hub · TEST'],
    ['UNKNOWN', 'ENTORNO DESCONOCIDO', 'Daubert Hub · UNKNOWN']
  ] as const)('renders the %s environment and updates the browser title', async (environment, label, title) => {
    mockWideViewport(true);
    vi.mocked(getRuntimeEnvironment).mockResolvedValue(environment as RuntimeEnvironment);

    renderShell();

    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(document.title).toBe(title);
  });

  it('shows an unknown environment without claiming test or production when the request fails', async () => {
    mockWideViewport(true);
    vi.mocked(getRuntimeEnvironment).mockRejectedValue(new Error('unavailable'));

    renderShell();

    expect(await screen.findByText('ENTORNO DESCONOCIDO')).toBeInTheDocument();
    expect(screen.queryByText('PRUEBAS')).not.toBeInTheDocument();
    expect(screen.queryByText('PRODUCCIÓN')).not.toBeInTheDocument();
    expect(document.title).toBe('Daubert Hub · UNKNOWN');
  });

  it('keeps the environment visible while navigating the application', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    vi.mocked(getRuntimeEnvironment).mockResolvedValue('TEST');
    renderShell();
    await screen.findByText('PRUEBAS');

    for (const destination of ['Proveedores', 'Clientes', 'Contactos', 'Automatizaciones']) {
      await user.click(screen.getByRole('link', { name: destination }));
      expect(screen.getByText('PRUEBAS')).toBeInTheDocument();
    }
  });

  it('defaults to expanded on a wide viewport and renders complete branding and labels', () => {
    mockWideViewport(true);
    renderShell();

    expect(shell()).toHaveAttribute('data-sidebar-collapsed', 'false');
    expect(screen.getByRole('img', { name: 'Daubert Cromwell' })).toBeInTheDocument();
    expect(screen.getByText('Hub de operaciones')).toBeInTheDocument();
    expect(screen.getByText('Empresas')).toBeInTheDocument();
    expect(screen.getByText('Inicio')).toBeInTheDocument();
    expect(screen.getByText('Proveedores')).toBeInTheDocument();
    expect(screen.getByText('Clientes')).toBeInTheDocument();
    expect(screen.getByText('Contactos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Contraer menú' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapses and expands without removing accessible navigation or active state', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell('/providers');
    const providerLink = screen.getByRole('link', { name: 'Proveedores' });
    expect(providerLink).toHaveAttribute('aria-current', 'page');
    expect(providerLink.querySelector('.Mui-selected')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Contraer menú' }));

    expect(shell()).toHaveAttribute('data-sidebar-collapsed', 'true');
    expect(screen.queryByText('Proveedores')).not.toBeInTheDocument();
    expect(screen.queryByText('Clientes')).not.toBeInTheDocument();
    expect(screen.queryByText('Empresas')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Daubert Cromwell' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Inicio' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Proveedores' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Clientes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contactos' })).toBeInTheDocument();
    await user.hover(screen.getByRole('link', { name: 'Proveedores' }));
    expect(await screen.findByRole('tooltip', { name: 'Proveedores' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expandir menú' })).toHaveAttribute('aria-expanded', 'false');

    await user.click(screen.getByRole('button', { name: 'Expandir menú' }));
    expect(shell()).toHaveAttribute('data-sidebar-collapsed', 'false');
    expect(screen.getByText('Proveedores')).toBeInTheDocument();
  });

  it('persists explicit collapse and expand preferences across remounts', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    const first = renderShell();
    await user.click(screen.getByRole('button', { name: 'Contraer menú' }));
    expect(localStorage.getItem('daubertHub.sidebarCollapsed')).toBe('true');
    first.unmount();

    const second = renderShell();
    expect(shell()).toHaveAttribute('data-sidebar-collapsed', 'true');
    await user.click(screen.getByRole('button', { name: 'Expandir menú' }));
    expect(localStorage.getItem('daubertHub.sidebarCollapsed')).toBe('false');
    second.unmount();

    renderShell();
    expect(shell()).toHaveAttribute('data-sidebar-collapsed', 'false');
  });

  it('defaults collapsed below 1200px and follows viewport changes until the user chooses', () => {
    const setWide = mockWideViewport(false);
    renderShell();
    expect(shell()).toHaveAttribute('data-sidebar-collapsed', 'true');

    setWide(true);
    expect(shell()).toHaveAttribute('data-sidebar-collapsed', 'false');
    setWide(false);
    expect(shell()).toHaveAttribute('data-sidebar-collapsed', 'true');
  });

  it.each([
    ['true', true, 'true'],
    ['false', false, 'false'],
    ['true', false, 'true'],
    ['false', true, 'false']
  ])('stored %s overrides wide=%s with collapsed=%s', (stored, wide, expected) => {
    localStorage.setItem('daubertHub.sidebarCollapsed', stored);
    mockWideViewport(wide);
    renderShell();
    expect(shell()).toHaveAttribute('data-sidebar-collapsed', expected);
  });

  it.each([
    [true, 'false'],
    [false, 'true']
  ])('falls back safely from malformed storage using wide=%s', (wide, expected) => {
    localStorage.setItem('daubertHub.sidebarCollapsed', 'unexpected');
    mockWideViewport(wide);
    renderShell();
    expect(shell()).toHaveAttribute('data-sidebar-collapsed', expected);
  });

  it('does not let later viewport changes overwrite an explicit preference', async () => {
    const user = userEvent.setup();
    const setWide = mockWideViewport(true);
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Contraer menú' }));
    setWide(false);
    setWide(true);
    expect(shell()).toHaveAttribute('data-sidebar-collapsed', 'true');
  });

  it('keeps existing navigation functional while collapsed', async () => {
    const user = userEvent.setup();
    mockWideViewport(false);
    renderShell();

    await user.click(screen.getByRole('link', { name: 'Contactos' }));

    expect(screen.getByText('Contacts page')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contactos' })).toHaveAttribute('aria-current', 'page');
    expect(shell()).toHaveAttribute('data-sidebar-collapsed', 'true');
  });

  it('navigates to Clients under the Empresas section without disturbing Providers navigation', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell('/providers');
    expect(screen.getByRole('link', { name: 'Proveedores' })).toHaveAttribute('aria-current', 'page');

    await user.click(screen.getByRole('link', { name: 'Clientes' }));

    expect(screen.getByText('Clients page')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clientes' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Proveedores' })).not.toHaveAttribute('aria-current', 'page');
  });
});
