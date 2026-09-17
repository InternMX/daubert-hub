import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTheme } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COLOR_MODE_STORAGE_KEY, ColorModeProvider } from '../theme';
import { LoginPage } from './LoginPage';
import { AuthContext, type AuthContextValue } from './authContext.core';

function ThemeModeProbe() {
  const theme = useTheme();
  return <output data-testid="palette-mode">{theme.palette.mode}</output>;
}

function renderLogin(overrides: Partial<AuthContextValue> = {}) {
  const authValue: AuthContextValue = {
    user: null,
    isLoading: false,
    hydrationFailed: false,
    login: async () => { throw new Error('not used in this test'); },
    logout: async () => undefined,
    refreshUser: async () => null,
    changePassword: async () => { throw new Error('not used in this test'); },
    ...overrides
  };
  return render(
    <ColorModeProvider>
      <AuthContext.Provider value={authValue}>
        <ThemeModeProbe />
        <LoginPage />
      </AuthContext.Provider>
    </ColorModeProvider>
  );
}

afterEach(() => localStorage.clear());

// The unauthenticated /login page is rendered directly under the app-level
// ColorModeProvider (see main.tsx: it wraps BrowserRouter/AuthProvider/App),
// so a saved dark preference must already apply here — a user should never
// see a light login page and then abruptly switch to dark after
// authenticating when a dark preference was already saved.
describe('LoginPage respects the saved appearance preference', () => {
  it('renders with the light palette by default', () => {
    renderLogin();
    expect(screen.getByTestId('palette-mode')).toHaveTextContent('light');
  });

  it('renders with the dark palette immediately when a saved dark preference exists', () => {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'dark');
    renderLogin();
    expect(screen.getByTestId('palette-mode')).toHaveTextContent('dark');
  });

  it('still renders the login form normally in dark mode', () => {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'dark');
    renderLogin();
    expect(screen.getByRole('heading', { name: 'Daubert Hub' })).toBeInTheDocument();
    expect(screen.getByLabelText('Correo electrónico')).toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument();
  });
});

// Password visibility UX fix: previously this field had no custom show/hide
// control at all, so users only saw the browser's own native reveal icon —
// which several browsers hide again once the field loses focus. These tests
// prove the field now carries a persistent custom control that behaves
// correctly regardless of focus.
describe('LoginPage password visibility toggle', () => {
  it('is available once a password is typed', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText('Contraseña'), 'a-typed-password');
    expect(screen.getByRole('button', { name: 'Mostrar contraseña' })).toBeInTheDocument();
  });

  it('remains available after the password field is blurred', async () => {
    const user = userEvent.setup();
    renderLogin();
    const passwordField = screen.getByLabelText('Contraseña');
    await user.type(passwordField, 'a-typed-password');
    passwordField.blur();
    expect(screen.getByRole('button', { name: 'Mostrar contraseña' })).toBeInTheDocument();
  });

  it('remains available once focus moves to another field entirely', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText('Contraseña'), 'a-typed-password');
    await user.click(screen.getByLabelText('Correo electrónico'));
    expect(screen.getByLabelText('Correo electrónico')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Mostrar contraseña' })).toBeInTheDocument();
  });

  it('toggling switches the field between password and text without altering the typed value', async () => {
    const user = userEvent.setup();
    renderLogin();
    const passwordField = screen.getByLabelText('Contraseña') as HTMLInputElement;
    await user.type(passwordField, 'a-typed-password');
    expect(passwordField).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(passwordField).toHaveAttribute('type', 'text');
    expect(passwordField.value).toBe('a-typed-password');

    await user.click(screen.getByRole('button', { name: 'Ocultar contraseña' }));
    expect(passwordField).toHaveAttribute('type', 'password');
    expect(passwordField.value).toBe('a-typed-password');
  });

  it('is reachable and activatable by keyboard', async () => {
    const user = userEvent.setup();
    renderLogin();
    const passwordField = screen.getByLabelText('Contraseña') as HTMLInputElement;
    await user.type(passwordField, 'a-typed-password');
    await user.tab(); // from the password field to its own toggle button
    expect(screen.getByRole('button', { name: 'Mostrar contraseña' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(passwordField).toHaveAttribute('type', 'text');
  });

  it('does not interfere with existing submit behavior, including while the field shows plaintext', async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockResolvedValue({ id: '1', displayName: 'Alejandro López', email: 'alejandro@daubertcromwell.com', role: 'ADMIN', status: 'ACTIVE', mustChangePassword: false });
    renderLogin({ login });
    await user.type(screen.getByLabelText('Correo electrónico'), 'alejandro@daubertcromwell.com');
    await user.type(screen.getByLabelText('Contraseña'), 'a-valid-password');
    await user.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    expect(login).toHaveBeenCalledWith('alejandro@daubertcromwell.com', 'a-valid-password');
  });
});
