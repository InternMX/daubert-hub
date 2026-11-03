import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '../auth/authContext.core';
import { getHealth, type RuntimeEnvironment } from '../services/health';
import { getSystemStatus, type SystemStatus } from '../services/systemStatus';
import { createAuthContextValue, testAdminUser, testGeneralUser, TestAuthProvider } from '../test/authTestUtils';
import { ColorModeProvider } from '../theme';
import { AppShell } from './AppShell';

vi.mock('../services/health', () => ({ getHealth: vi.fn() }));
vi.mock('../services/systemStatus', () => ({ getSystemStatus: vi.fn() }));

function mockHealth(environment: RuntimeEnvironment, version: string | null = null, commit: string | null = null) {
  vi.mocked(getHealth).mockResolvedValue({ environment, version, commit });
}

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

function renderShell(path = '/', authValue?: Partial<AuthContextValue>) {
  return render(<MemoryRouter initialEntries={[path]}><ColorModeProvider><TestAuthProvider value={authValue}><AppShell><Routes>
    <Route path="/" element={<div>Inicio page</div>} />
    <Route path="/providers" element={<div>Providers page</div>} />
    <Route path="/clients" element={<div>Clients page</div>} />
    <Route path="/contacts" element={<div>Contacts page</div>} />
    <Route path="/automations" element={<div>Automations page</div>} />
    <Route path="/automations/remissions/audi" element={<div>Audi page</div>} />
    <Route path="/automations/payment-notifications" element={<div>Payment Notifications page</div>} />
    <Route path="/automations/payment-notifications/:executionId" element={<div>Payment Notifications detail page</div>} />
    <Route path="/automations/remissions/caterpillar" element={<div>Caterpillar page</div>} />
    <Route path="/automations/manufacturing-sheets" element={<div>Manufacturing sheets page</div>} />
  </Routes></AppShell></TestAuthProvider></ColorModeProvider></MemoryRouter>);
}

function shell() { return screen.getByTestId('app-shell'); }

beforeEach(() => {
  localStorage.clear();
  document.title = 'Daubert Hub';
  vi.mocked(getHealth).mockReset();
  vi.mocked(getHealth).mockImplementation(() => new Promise<never>(() => undefined));
  vi.mocked(getSystemStatus).mockReset();
  vi.mocked(getSystemStatus).mockImplementation(() => new Promise<never>(() => undefined));
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
    mockHealth(environment as RuntimeEnvironment);

    renderShell();

    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(document.title).toBe(title);
  });

  it('shows an unknown environment without claiming test or production when the request fails', async () => {
    mockWideViewport(true);
    vi.mocked(getHealth).mockRejectedValue(new Error('unavailable'));

    renderShell();

    expect(await screen.findByText('ENTORNO DESCONOCIDO')).toBeInTheDocument();
    expect(screen.queryByText('PRUEBAS')).not.toBeInTheDocument();
    expect(screen.queryByText('PRODUCCIÓN')).not.toBeInTheDocument();
    expect(document.title).toBe('Daubert Hub · UNKNOWN');
  });

  it('keeps the environment visible while navigating the application', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    mockHealth('TEST');
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

describe('AppShell version footer', () => {
  it('renders the discreet "vX.Y.Z" version near the bottom of the expanded sidebar', async () => {
    mockWideViewport(true);
    mockHealth('TEST', '0.8.0-pilot.1', 'a1b2c3d');

    renderShell();

    expect(await screen.findByText('v0.8.0-pilot.1')).toBeInTheDocument();
    // Never prominent — the raw commit SHA must not appear as visible text.
    expect(screen.queryByText('a1b2c3d')).not.toBeInTheDocument();
  });

  it('exposes "vX.Y.Z · commit" only via tooltip, not in the visible UI', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    mockHealth('TEST', '0.8.0-pilot.1', 'a1b2c3d');
    renderShell();
    const versionText = await screen.findByText('v0.8.0-pilot.1');

    await user.hover(versionText);

    expect(await screen.findByRole('tooltip', { name: 'v0.8.0-pilot.1 · a1b2c3d' })).toBeInTheDocument();
  });

  it('hides the version entirely while the sidebar is collapsed, and the sidebar remains otherwise usable', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    mockHealth('TEST', '0.8.0-pilot.1', 'a1b2c3d');
    renderShell();
    await screen.findByText('v0.8.0-pilot.1');

    await user.click(screen.getByRole('button', { name: 'Contraer menú' }));

    expect(shell()).toHaveAttribute('data-sidebar-collapsed', 'true');
    expect(screen.queryByText('v0.8.0-pilot.1')).not.toBeInTheDocument();
    // Collapsed sidebar remains fully usable: navigation and logout still work.
    expect(screen.getByRole('link', { name: 'Inicio' })).toBeInTheDocument();
  });

  it('renders nothing (no crash, no empty placeholder) when the backend does not report a version', async () => {
    mockWideViewport(true);
    mockHealth('TEST', null, null);

    renderShell();

    await screen.findByText('PRUEBAS');
    expect(screen.queryByText(/^v\d/)).not.toBeInTheDocument();
  });
});

describe('AppShell appearance toggle', () => {
  it('shows the moon icon with "Activar modo oscuro" in light mode by default', async () => {
    mockWideViewport(true);
    mockHealth('TEST');
    renderShell();

    expect(await screen.findByRole('button', { name: 'Activar modo oscuro' })).toBeInTheDocument();
  });

  it('initializes directly in dark mode when a saved dark preference exists, without a visible light flash in the rendered state', async () => {
    localStorage.setItem('daubertHub.colorMode', 'dark');
    mockWideViewport(true);
    mockHealth('TEST');
    renderShell();

    expect(await screen.findByRole('button', { name: 'Activar modo claro' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activar modo oscuro' })).not.toBeInTheDocument();
  });

  it('toggling switches the icon/aria-label from "Activar modo oscuro" to "Activar modo claro" and back, and persists to localStorage', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    mockHealth('TEST');
    renderShell();
    const toggle = await screen.findByRole('button', { name: 'Activar modo oscuro' });

    await user.click(toggle);

    expect(screen.getByRole('button', { name: 'Activar modo claro' })).toBeInTheDocument();
    expect(localStorage.getItem('daubertHub.colorMode')).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'Activar modo claro' }));

    expect(screen.getByRole('button', { name: 'Activar modo oscuro' })).toBeInTheDocument();
    expect(localStorage.getItem('daubertHub.colorMode')).toBe('light');
  });

  it('is keyboard accessible and shows a tooltip', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    mockHealth('TEST');
    renderShell();
    const toggle = await screen.findByRole('button', { name: 'Activar modo oscuro' });

    await user.hover(toggle);
    expect(await screen.findByRole('tooltip', { name: 'Activar modo oscuro' })).toBeInTheDocument();

    toggle.focus();
    expect(toggle).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('button', { name: 'Activar modo claro' })).toBeInTheDocument();
  });

  it('works while the sidebar is collapsed', async () => {
    const user = userEvent.setup();
    mockWideViewport(false);
    mockHealth('TEST');
    renderShell();

    expect(shell()).toHaveAttribute('data-sidebar-collapsed', 'true');
    const toggle = await screen.findByRole('button', { name: 'Activar modo oscuro' });
    await user.click(toggle);

    expect(screen.getByRole('button', { name: 'Activar modo claro' })).toBeInTheDocument();
    expect(localStorage.getItem('daubertHub.colorMode')).toBe('dark');
  });

  it('works while the sidebar is expanded', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    mockHealth('TEST');
    renderShell();

    expect(shell()).toHaveAttribute('data-sidebar-collapsed', 'false');
    const toggle = await screen.findByRole('button', { name: 'Activar modo oscuro' });
    await user.click(toggle);

    expect(screen.getByRole('button', { name: 'Activar modo claro' })).toBeInTheDocument();
  });

  it('remains visually secondary to logout: both reachable, logout still functions after toggling appearance', async () => {
    const user = userEvent.setup();
    const logout = vi.fn().mockResolvedValue(undefined);
    mockWideViewport(true);
    mockHealth('TEST');
    renderShell('/', createAuthContextValue({ user: testAdminUser, logout }));

    const toggle = await screen.findByRole('button', { name: 'Activar modo oscuro' });
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Cuenta de usuario' }));
    await user.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }));

    expect(logout).toHaveBeenCalledTimes(1);
  });
});

describe('AppShell account control (expanded)', () => {
  it('shows the authenticated ADMIN user with the Spanish role label in the identity row, without opening the menu', () => {
    mockWideViewport(true);
    renderShell('/', createAuthContextValue({ user: testAdminUser }));

    expect(screen.getByText('Alejandro López')).toBeInTheDocument();
    expect(screen.getByText('Administrador')).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('shows the authenticated GENERAL user with the Spanish role label', () => {
    mockWideViewport(true);
    renderShell('/', createAuthContextValue({ user: testGeneralUser }));

    expect(screen.getByText('Ana Ruiz')).toBeInTheDocument();
    expect(screen.getByText('General')).toBeInTheDocument();
  });

  it('exposes the identity row as a single accessible control with the documented aria-label', () => {
    mockWideViewport(true);
    renderShell('/', createAuthContextValue({ user: testAdminUser }));

    expect(screen.getByRole('button', { name: 'Cuenta de usuario' })).toBeInTheDocument();
  });

  it('is keyboard accessible: Enter opens the menu', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell('/', createAuthContextValue({ user: testAdminUser }));

    screen.getByRole('button', { name: 'Cuenta de usuario' }).focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });

  it('is keyboard accessible: Space opens the menu', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell('/', createAuthContextValue({ user: testAdminUser }));

    screen.getByRole('button', { name: 'Cuenta de usuario' }).focus();
    await user.keyboard(' ');

    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });
});

describe('AppShell account menu', () => {
  it('opens on click and shows displayName, email, and the translated role', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell('/', createAuthContextValue({ user: testAdminUser }));

    await user.click(screen.getByRole('button', { name: 'Cuenta de usuario' }));
    const menu = await screen.findByRole('menu');

    expect(within(menu).getByText(testAdminUser.displayName)).toBeInTheDocument();
    expect(within(menu).getByText(testAdminUser.email)).toBeInTheDocument();
    expect(within(menu).getByText('Administrador')).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Cerrar sesión' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Mi perfil' })).toHaveAttribute('href', '/profile');
  });

  it('translates the GENERAL role in the menu too, using actual user data — nothing hardcoded', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell('/', createAuthContextValue({ user: testGeneralUser }));

    await user.click(screen.getByRole('button', { name: 'Cuenta de usuario' }));
    const menu = await screen.findByRole('menu');

    expect(within(menu).getByText(testGeneralUser.displayName)).toBeInTheDocument();
    expect(within(menu).getByText(testGeneralUser.email)).toBeInTheDocument();
    expect(within(menu).getByText('General')).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell('/', createAuthContextValue({ user: testAdminUser }));

    await user.click(screen.getByRole('button', { name: 'Cuenta de usuario' }));
    await screen.findByRole('menu');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('closes when clicking outside', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell('/', createAuthContextValue({ user: testAdminUser }));

    await user.click(screen.getByRole('button', { name: 'Cuenta de usuario' }));
    await screen.findByRole('menu');
    // MUI's Menu/Popover renders a click-away backdrop (transparent, but
    // real and clickable) in front of the rest of the page while open —
    // that's the "outside" target a real user would click.
    const backdrop = document.querySelector('.MuiBackdrop-root');
    expect(backdrop).not.toBeNull();
    await user.click(backdrop as HTMLElement);

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('does not log out merely by clicking the account control — only "Cerrar sesión" does', async () => {
    const user = userEvent.setup();
    const logout = vi.fn().mockResolvedValue(undefined);
    mockWideViewport(true);
    renderShell('/', createAuthContextValue({ user: testAdminUser, logout }));

    await user.click(screen.getByRole('button', { name: 'Cuenta de usuario' }));
    await screen.findByRole('menu');

    expect(logout).not.toHaveBeenCalled();
  });

  it('"Cerrar sesión" invokes AuthContext logout() on click', async () => {
    const user = userEvent.setup();
    const logout = vi.fn().mockResolvedValue(undefined);
    mockWideViewport(true);
    renderShell('/', createAuthContextValue({ user: testAdminUser, logout }));

    await user.click(screen.getByRole('button', { name: 'Cuenta de usuario' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Cerrar sesión' }));

    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('"Cerrar sesión" is keyboard accessible: Enter activates the focused menu item', async () => {
    const user = userEvent.setup();
    const logout = vi.fn().mockResolvedValue(undefined);
    mockWideViewport(true);
    renderShell('/', createAuthContextValue({ user: testAdminUser, logout }));

    await user.click(screen.getByRole('button', { name: 'Cuenta de usuario' }));
    const logoutItem = await screen.findByRole('menuitem', { name: 'Cerrar sesión' });
    logoutItem.focus();
    await user.keyboard('{Enter}');

    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('disables "Cerrar sesión" and prevents duplicate logout calls while a logout is pending', async () => {
    const user = userEvent.setup();
    let resolveLogout: () => void = () => undefined;
    const logout = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { resolveLogout = resolve; }));
    mockWideViewport(true);
    renderShell('/', createAuthContextValue({ user: testAdminUser, logout }));

    await user.click(screen.getByRole('button', { name: 'Cuenta de usuario' }));
    const logoutItem = await screen.findByRole('menuitem', { name: 'Cerrar sesión' });
    await user.click(logoutItem);

    // Disabled via MUI's real Mui-disabled state (pointer-events: none),
    // not just a visual style — a second click genuinely cannot land on it,
    // exactly like a real browser. That IS the duplicate-call prevention;
    // userEvent enforces this the same way a real user's click would fail.
    await waitFor(() => expect(logoutItem).toHaveAttribute('aria-disabled', 'true'));
    await expect(user.click(logoutItem)).rejects.toThrow(/pointer-events/);
    expect(logout).toHaveBeenCalledTimes(1);

    resolveLogout();
  });
});

describe('AppShell account control (collapsed)', () => {
  it('shows only a centered avatar, hiding name/role text', () => {
    mockWideViewport(false);
    renderShell('/', createAuthContextValue({ user: testAdminUser }));

    expect(screen.queryByText('Alejandro López')).not.toBeInTheDocument();
    expect(screen.queryByText('Administrador')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cuenta de usuario' })).toBeInTheDocument();
  });

  it('has no standalone logout icon/button adjacent to the avatar', () => {
    mockWideViewport(false);
    renderShell('/', createAuthContextValue({ user: testAdminUser }));

    expect(screen.queryByRole('button', { name: 'Cerrar sesión' })).not.toBeInTheDocument();
  });

  it('shows a tooltip with the display name and role on the collapsed avatar', async () => {
    const user = userEvent.setup();
    mockWideViewport(false);
    renderShell('/', createAuthContextValue({ user: testAdminUser }));

    await user.hover(screen.getByRole('button', { name: 'Cuenta de usuario' }));

    expect(await screen.findByRole('tooltip', { name: 'Alejandro López · Administrador' })).toBeInTheDocument();
  });

  it('still opens the account menu and logs out correctly while collapsed', async () => {
    const user = userEvent.setup();
    const logout = vi.fn().mockResolvedValue(undefined);
    mockWideViewport(false);
    renderShell('/', createAuthContextValue({ user: testAdminUser, logout }));

    await user.click(screen.getByRole('button', { name: 'Cuenta de usuario' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText(testAdminUser.email)).toBeInTheDocument();

    await user.click(within(menu).getByRole('menuitem', { name: 'Cerrar sesión' }));
    expect(logout).toHaveBeenCalledTimes(1);
  });
});

describe('AppShell navigation grouping (Operación vs Administración)', () => {
  it('shows GENERAL the Operación section with Automatizaciones, and no Administración section at all', () => {
    mockWideViewport(true);
    renderShell('/', createAuthContextValue({ user: testGeneralUser }));

    expect(screen.getByText('Operación')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Automatizaciones' })).toHaveAttribute('href', '/automations');
    expect(screen.queryByText('Administración')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Usuarios' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Auditoría' })).not.toBeInTheDocument();
  });

  it('shows ADMIN both the Operación section (Automatizaciones) and the Administración section (Usuarios)', () => {
    mockWideViewport(true);
    renderShell('/', createAuthContextValue({ user: testAdminUser }));

    expect(screen.getByText('Operación')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Automatizaciones' })).toHaveAttribute('href', '/automations');
    expect(screen.getByText('Administración')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Usuarios' })).toHaveAttribute('href', '/users');
    expect(screen.getByRole('link', { name: 'Auditoría' })).toHaveAttribute('href', '/audit');
  });

  it('places Automatizaciones before Usuarios in document order (Operación above Administración)', () => {
    mockWideViewport(true);
    renderShell('/', createAuthContextValue({ user: testAdminUser }));

    const automatizaciones = screen.getByRole('link', { name: 'Automatizaciones' });
    const usuarios = screen.getByRole('link', { name: 'Usuarios' });
    expect(automatizaciones.compareDocumentPosition(usuarios) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// Phase 12A.4e: split-button interaction. The main "Automatizaciones" area is a real NavLink to
// /automations; the arrow is a separate sibling <button> ("Mostrar automatizaciones" /
// "Ocultar automatizaciones", toggling with aria-expanded) that only opens/closes the submenu and
// never navigates. "Panel general" was removed from the submenu since the main area itself now
// covers that destination directly.
describe('AppShell Automatizaciones submenu', () => {
  it('clicking the main area navigates directly to /automations', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell();

    await user.click(screen.getByRole('link', { name: 'Automatizaciones' }));

    expect(screen.getByText('Automations page')).toBeInTheDocument();
    expect(screen.queryByRole('menu', { name: 'Submenú de Automatizaciones' })).not.toBeInTheDocument();
  });

  it('no longer offers "Panel general" as a submenu item', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Mostrar automatizaciones' }));
    const menu = await screen.findByRole('menu', { name: 'Submenú de Automatizaciones' });

    expect(within(menu).queryByText('Panel general')).not.toBeInTheDocument();
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(4);
  });

  it('clicking the arrow opens the submenu with Remisiones Audi, Notificaciones de pago, Remisiones Caterpillar and Hojas de manufactura, without navigating', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Mostrar automatizaciones' }));

    const menu = await screen.findByRole('menu', { name: 'Submenú de Automatizaciones' });
    expect(within(menu).getByRole('menuitem', { name: 'Remisiones Audi' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Notificaciones de pago' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Remisiones Caterpillar' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Hojas de manufactura' })).toBeInTheDocument();
    // The arrow click never navigated away from the current page.
    expect(screen.queryByText('Automations page')).not.toBeInTheDocument();
  });

  it('clicking the arrow again closes the submenu (toggle behavior)', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell();

    const arrow = screen.getByRole('button', { name: 'Mostrar automatizaciones' });
    await user.click(arrow);
    await screen.findByRole('menu', { name: 'Submenú de Automatizaciones' });

    // Re-querying by role here would fail: MUI marks the trigger aria-hidden (as background
    // content) while its own modal menu is open, so the live element reference is reused instead.
    expect(arrow).toHaveAttribute('aria-label', 'Ocultar automatizaciones');
    await user.click(arrow);

    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Submenú de Automatizaciones' })).not.toBeInTheDocument());
  });

  it('the arrow click stops propagation and never triggers the main area\'s navigation', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Mostrar automatizaciones' }));
    await screen.findByRole('menu', { name: 'Submenú de Automatizaciones' });

    expect(screen.queryByText('Automations page')).not.toBeInTheDocument();
  });

  it('aria-expanded reflects open/closed state on the arrow toggle', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell();

    const arrow = screen.getByRole('button', { name: 'Mostrar automatizaciones' });
    expect(arrow).not.toHaveAttribute('aria-expanded', 'true');

    await user.click(arrow);
    await screen.findByRole('menu', { name: 'Submenú de Automatizaciones' });
    // Re-querying by role would fail here — MUI marks the trigger aria-hidden while its own
    // modal menu is open — so the same live element reference is checked directly instead.
    expect(arrow).toHaveAttribute('aria-label', 'Ocultar automatizaciones');
    expect(arrow).toHaveAttribute('aria-expanded', 'true');
    expect(arrow).toHaveAttribute('aria-haspopup', 'true');
  });

  it('is keyboard accessible: Enter on the focused arrow toggle opens the submenu', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell();

    screen.getByRole('button', { name: 'Mostrar automatizaciones' }).focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('menu', { name: 'Submenú de Automatizaciones' })).toBeInTheDocument();
  });

  it('is keyboard accessible: Enter again on the focused (now open) arrow toggle closes the submenu', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell();

    const arrow = screen.getByRole('button', { name: 'Mostrar automatizaciones' });
    arrow.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menu', { name: 'Submenú de Automatizaciones' });

    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Submenú de Automatizaciones' })).not.toBeInTheDocument());
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Mostrar automatizaciones' }));
    await screen.findByRole('menu', { name: 'Submenú de Automatizaciones' });
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Submenú de Automatizaciones' })).not.toBeInTheDocument());
  });

  it('navigates to Remisiones Audi from the submenu', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Mostrar automatizaciones' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remisiones Audi' }));

    expect(await screen.findByText('Audi page')).toBeInTheDocument();
  });

  it('navigates to Hojas de manufactura from the submenu (route /automations/manufacturing-sheets)', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Mostrar automatizaciones' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Hojas de manufactura' }));

    expect(await screen.findByText('Manufacturing sheets page')).toBeInTheDocument();
  });

  it('navigates to Notificaciones de pago from the submenu', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Mostrar automatizaciones' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Notificaciones de pago' }));

    expect(await screen.findByText('Payment Notifications page')).toBeInTheDocument();
  });

  it('navigates to Remisiones Caterpillar from the submenu, to the same route AutomationsPage.tsx uses', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Mostrar automatizaciones' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remisiones Caterpillar' }));

    expect(await screen.findByText('Caterpillar page')).toBeInTheDocument();
  });

  it.each([
    ['ADMIN', testAdminUser],
    ['GENERAL', testGeneralUser]
  ] as const)('shows the enabled Remisiones Caterpillar submenu item for %s', async (_role, user) => {
    const userEventInstance = userEvent.setup();
    mockWideViewport(true);
    renderShell('/', { user });

    await userEventInstance.click(screen.getByRole('button', { name: 'Mostrar automatizaciones' }));
    const menu = await screen.findByRole('menu', { name: 'Submenú de Automatizaciones' });
    const caterpillarItem = within(menu).getByRole('menuitem', { name: 'Remisiones Caterpillar' });
    expect(caterpillarItem).not.toHaveAttribute('aria-disabled', 'true');
  });

  it.each([
    ['ADMIN', testAdminUser],
    ['GENERAL', testGeneralUser]
  ] as const)('%s can also navigate directly via the main Automatizaciones area', async (_role, user) => {
    const userEventInstance = userEvent.setup();
    mockWideViewport(true);
    renderShell('/', { user });

    await userEventInstance.click(screen.getByRole('link', { name: 'Automatizaciones' }));
    expect(await screen.findByText('Automations page')).toBeInTheDocument();
  });

  // Phase 12A.4g: hover-to-open was removed entirely — in the real built UI, hovering the arrow
  // while the mouse stayed put made the submenu flicker open/closed. Click/keyboard are the only
  // ways to open or close it now, for both the arrow and the main area.
  it('hovering the arrow area does NOT open the submenu', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell();

    await user.hover(screen.getByRole('button', { name: 'Mostrar automatizaciones' }));

    // Give any (incorrect) async open a chance to happen before asserting its absence.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('menu', { name: 'Submenú de Automatizaciones' })).not.toBeInTheDocument();
  });

  it('hovering the main navigable area does NOT open the submenu', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell();

    await user.hover(screen.getByRole('link', { name: 'Automatizaciones' }));

    // Give any (incorrect) async open a chance to happen before asserting its absence.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('menu', { name: 'Submenú de Automatizaciones' })).not.toBeInTheDocument();
  });

  it('hovering the arrow then clicking it still opens the submenu on exactly the first click (no flicker/instant re-close)', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell();

    const arrow = screen.getByRole('button', { name: 'Mostrar automatizaciones' });
    await user.hover(arrow);
    await user.click(arrow);

    expect(await screen.findByRole('menu', { name: 'Submenú de Automatizaciones' })).toBeInTheDocument();
  });

  describe('collapsed sidebar', () => {
    it('opens the submenu via a click on the icon (no separate chevron needed) — collapsed mode keeps the icon as a pure disclosure control', async () => {
      const user = userEvent.setup();
      mockWideViewport(false);
      renderShell();
      expect(shell()).toHaveAttribute('data-sidebar-collapsed', 'true');

      const trigger = screen.getByRole('button', { name: 'Automatizaciones' });
      expect(trigger).toHaveAttribute('aria-haspopup', 'true');
      await user.click(trigger);

      const menu = await screen.findByRole('menu', { name: 'Submenú de Automatizaciones' });
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(trigger).toHaveAttribute('aria-controls', 'automations-submenu');
      await user.click(within(menu).getByRole('menuitem', { name: 'Remisiones Audi' }));

      expect(await screen.findByText('Audi page')).toBeInTheDocument();
    });

    it('clicking the icon again closes the submenu (toggle behavior)', async () => {
      const user = userEvent.setup();
      mockWideViewport(false);
      renderShell();

      const trigger = screen.getByRole('button', { name: 'Automatizaciones' });
      await user.click(trigger);
      await screen.findByRole('menu', { name: 'Submenú de Automatizaciones' });

      await user.click(trigger);
      await waitFor(() => expect(screen.queryByRole('menu', { name: 'Submenú de Automatizaciones' })).not.toBeInTheDocument());
    });

    it('opens via keyboard Enter', async () => {
      const user = userEvent.setup();
      mockWideViewport(false);
      renderShell();

      screen.getByRole('button', { name: 'Automatizaciones' }).focus();
      await user.keyboard('{Enter}');

      expect(await screen.findByRole('menu', { name: 'Submenú de Automatizaciones' })).toBeInTheDocument();
    });

    it('opens via keyboard Space', async () => {
      const user = userEvent.setup();
      mockWideViewport(false);
      renderShell();

      screen.getByRole('button', { name: 'Automatizaciones' }).focus();
      await user.keyboard(' ');

      expect(await screen.findByRole('menu', { name: 'Submenú de Automatizaciones' })).toBeInTheDocument();
    });

    it('closes on Escape', async () => {
      const user = userEvent.setup();
      mockWideViewport(false);
      renderShell();

      await user.click(screen.getByRole('button', { name: 'Automatizaciones' }));
      await screen.findByRole('menu', { name: 'Submenú de Automatizaciones' });
      await user.keyboard('{Escape}');

      await waitFor(() => expect(screen.queryByRole('menu', { name: 'Submenú de Automatizaciones' })).not.toBeInTheDocument());
    });

    // Phase 12A.4g: hover-to-open was removed entirely, including in the collapsed icon.
    it('hovering the icon does NOT open the submenu', async () => {
      const user = userEvent.setup();
      mockWideViewport(false);
      renderShell();

      await user.hover(screen.getByRole('button', { name: 'Automatizaciones' }));

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.queryByRole('menu', { name: 'Submenú de Automatizaciones' })).not.toBeInTheDocument();
    });

    it('navigates to Remisiones Audi and Notificaciones de pago from the collapsed submenu', async () => {
      const user = userEvent.setup();
      mockWideViewport(false);
      renderShell();

      await user.click(screen.getByRole('button', { name: 'Automatizaciones' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Remisiones Audi' }));
      expect(await screen.findByText('Audi page')).toBeInTheDocument();
    });
  });
});

describe('AppShell Automatizaciones submenu — current-route awareness', () => {
  async function openSubmenu(user: ReturnType<typeof userEvent.setup>) {
    // Exact labels only — a loose /automatizaciones/i match also catches the main link's own
    // "Automatizaciones" text button in expanded mode, which is a different control entirely.
    const trigger = screen.queryByRole('button', { name: 'Mostrar automatizaciones' }) ?? screen.getByRole('button', { name: 'Automatizaciones' });
    await user.click(trigger);
    return screen.findByRole('menu', { name: 'Submenú de Automatizaciones' });
  }

  it.each([
    ['/automations/remissions/audi', 'Remisiones Audi', 'Audi page'],
    ['/automations/payment-notifications', 'Notificaciones de pago', 'Payment Notifications page'],
    ['/automations/remissions/caterpillar', 'Remisiones Caterpillar', 'Caterpillar page'],
    ['/automations/manufacturing-sheets', 'Hojas de manufactura', 'Manufacturing sheets page']
  ] as const)('marks %s as the current, non-navigable destination (%s)', async (path, label, pageText) => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell(path);

    const menu = await openSubmenu(user);
    const currentItem = within(menu).getByRole('menuitem', { name: label });

    expect(currentItem).toHaveAttribute('aria-current', 'page');
    expect(currentItem.tagName).not.toBe('A');
    expect(currentItem).not.toHaveAttribute('href');
    // Never the disabled/unavailable visual language.
    expect(currentItem).not.toHaveAttribute('aria-disabled');

    await user.click(currentItem);
    expect(screen.getByText(pageText)).toBeInTheDocument();
  });

  // /automations itself has no submenu item representing it any more — the parent control is the
  // one marked active (see the test below), and no child should be selected.
  it('marks no submenu child as current when the path is exactly /automations', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell('/automations');

    const menu = await openSubmenu(user);
    for (const label of ['Remisiones Audi', 'Notificaciones de pago', 'Remisiones Caterpillar', 'Hojas de manufactura']) {
      expect(within(menu).getByRole('menuitem', { name: label })).not.toHaveAttribute('aria-current');
    }
  });

  it('treats a Payment Notifications execution detail route as still Notificaciones de pago current', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell('/automations/payment-notifications/9007199254740993');

    const menu = await openSubmenu(user);
    const currentItem = within(menu).getByRole('menuitem', { name: 'Notificaciones de pago' });

    expect(currentItem).toHaveAttribute('aria-current', 'page');
    expect(currentItem.tagName).not.toBe('A');
  });

  it('keeps the other, non-current destinations navigable as ordinary links', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell('/automations/remissions/audi');

    const menu = await openSubmenu(user);
    const paymentItem = within(menu).getByRole('menuitem', { name: 'Notificaciones de pago' });

    expect(paymentItem.tagName).toBe('A');
    expect(paymentItem).not.toHaveAttribute('aria-current');
    await user.click(paymentItem);
    expect(await screen.findByText('Payment Notifications page')).toBeInTheDocument();
  });

  it('keeps Remisiones Caterpillar navigable (not disabled, not current) from another automations page', async () => {
    const user = userEvent.setup();
    mockWideViewport(true);
    renderShell('/automations/remissions/audi');

    const menu = await openSubmenu(user);
    const caterpillarItem = within(menu).getByRole('menuitem', { name: 'Remisiones Caterpillar' });

    expect(caterpillarItem).not.toHaveAttribute('aria-disabled', 'true');
    expect(caterpillarItem).not.toHaveAttribute('aria-current');
    expect(caterpillarItem.tagName).toBe('A');
    await user.click(caterpillarItem);
    expect(await screen.findByText('Caterpillar page')).toBeInTheDocument();
  });

  it('the parent Automatizaciones item stays visually active for every /automations/* route, including exactly /automations', () => {
    mockWideViewport(true);
    renderShell('/automations');
    expect(screen.getByRole('link', { name: 'Automatizaciones' })).toHaveAttribute('aria-current', 'page');
  });

  it('the parent Automatizaciones item stays visually active for a nested automation route', () => {
    mockWideViewport(true);
    renderShell('/automations/payment-notifications/123');
    expect(screen.getByRole('link', { name: 'Automatizaciones' })).toHaveAttribute('aria-current', 'page');
  });

  it('works identically in the collapsed sidebar', async () => {
    const user = userEvent.setup();
    mockWideViewport(false);
    renderShell('/automations/remissions/audi');

    const menu = await openSubmenu(user);
    const currentItem = within(menu).getByRole('menuitem', { name: 'Remisiones Audi' });

    expect(currentItem).toHaveAttribute('aria-current', 'page');
    expect(currentItem.tagName).not.toBe('A');
  });
});

function n8nStatus(status: SystemStatus['n8n']['status'], latencyMs: number | null = null): SystemStatus {
  return { n8n: { status, latencyMs, checkedAt: '2026-01-01T12:00:00.000Z' } };
}

describe('AppShell n8n availability indicator', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('shows nothing while the first check is pending', () => {
    mockWideViewport(true);
    renderShell();
    expect(screen.queryByText(/n8n/)).not.toBeInTheDocument();
  });

  it('shows "n8n conectado" with latency when n8n is UP', async () => {
    mockWideViewport(true);
    vi.mocked(getSystemStatus).mockResolvedValue(n8nStatus('UP', 42));
    renderShell();
    expect(await screen.findByText('n8n conectado · 42 ms')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'n8n conectado' })).toBeInTheDocument();
  });

  it('shows "n8n no disponible" when n8n is DOWN', async () => {
    mockWideViewport(true);
    vi.mocked(getSystemStatus).mockResolvedValue(n8nStatus('DOWN'));
    renderShell();
    expect(await screen.findByText('n8n no disponible')).toBeInTheDocument();
  });

  it('shows "n8n sin configurar" when NOT_CONFIGURED', async () => {
    mockWideViewport(true);
    vi.mocked(getSystemStatus).mockResolvedValue(n8nStatus('NOT_CONFIGURED'));
    renderShell();
    expect(await screen.findByText('n8n sin configurar')).toBeInTheDocument();
  });

  it('shows the dot only (still labelled) when the sidebar is collapsed', async () => {
    mockWideViewport(false);
    vi.mocked(getSystemStatus).mockResolvedValue(n8nStatus('UP', 10));
    renderShell();
    expect(await screen.findByRole('status', { name: 'n8n conectado' })).toBeInTheDocument();
    expect(screen.queryByText(/n8n conectado/)).not.toBeInTheDocument();
  });

  it('does not break the shell when the status request fails', async () => {
    mockWideViewport(true);
    vi.mocked(getSystemStatus).mockRejectedValue(new Error('SYSTEM_STATUS_UNAVAILABLE'));
    renderShell();
    expect(await screen.findByText('n8n sin verificar')).toBeInTheDocument();
    expect(screen.getByText('Inicio page')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Proveedores' })).toBeInTheDocument();
  });

  it('checks on load, polls about every 30 seconds, and clears the timer on unmount', async () => {
    mockWideViewport(true);
    vi.useFakeTimers();
    vi.mocked(getSystemStatus).mockResolvedValue(n8nStatus('UP', 5));
    const { unmount } = renderShell();

    expect(getSystemStatus).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
    expect(getSystemStatus).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(getSystemStatus).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(getSystemStatus).toHaveBeenCalledTimes(3);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(getSystemStatus).toHaveBeenCalledTimes(3);
  });

  it('aborts the in-flight request on unmount', () => {
    mockWideViewport(true);
    const { unmount } = renderShell();
    const signal = vi.mocked(getSystemStatus).mock.calls[0]![0]!;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
