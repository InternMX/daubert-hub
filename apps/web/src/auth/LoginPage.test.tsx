import { render, screen } from '@testing-library/react';
import { useTheme } from '@mui/material/styles';
import { afterEach, describe, expect, it } from 'vitest';
import { COLOR_MODE_STORAGE_KEY, ColorModeProvider } from '../theme';
import { LoginPage } from './LoginPage';
import { AuthContext, type AuthContextValue } from './authContext.core';

function ThemeModeProbe() {
  const theme = useTheme();
  return <output data-testid="palette-mode">{theme.palette.mode}</output>;
}

function renderLogin() {
  const authValue: AuthContextValue = {
    user: null,
    isLoading: false,
    hydrationFailed: false,
    login: async () => { throw new Error('not used in this test'); },
    logout: async () => undefined,
    refreshUser: async () => null,
    changePassword: async () => { throw new Error('not used in this test'); }
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
