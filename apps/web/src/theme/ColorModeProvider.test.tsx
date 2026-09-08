import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTheme } from '@mui/material/styles';
import { COLOR_MODE_STORAGE_KEY, useColorMode } from './colorMode.core';
import { ColorModeProvider } from './ColorModeProvider';

function Probe() {
  const { mode, toggleColorMode } = useColorMode();
  const theme = useTheme();
  return (
    <div>
      <output data-testid="mode">{mode}</output>
      <output data-testid="palette-mode">{theme.palette.mode}</output>
      <button onClick={toggleColorMode}>Alternar</button>
    </div>
  );
}

afterEach(() => localStorage.clear());

describe('ColorModeProvider', () => {
  it('defaults to light mode when nothing is stored', () => {
    render(<ColorModeProvider><Probe /></ColorModeProvider>);
    expect(screen.getByTestId('mode')).toHaveTextContent('light');
    expect(screen.getByTestId('palette-mode')).toHaveTextContent('light');
  });

  it('initializes in dark mode when a saved dark preference exists', () => {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'dark');
    render(<ColorModeProvider><Probe /></ColorModeProvider>);
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
    expect(screen.getByTestId('palette-mode')).toHaveTextContent('dark');
  });

  it('falls back to light for an invalid saved preference', () => {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'sepia');
    render(<ColorModeProvider><Probe /></ColorModeProvider>);
    expect(screen.getByTestId('mode')).toHaveTextContent('light');
  });

  it('toggles light -> dark and persists it to localStorage', async () => {
    const user = userEvent.setup();
    render(<ColorModeProvider><Probe /></ColorModeProvider>);
    expect(screen.getByTestId('mode')).toHaveTextContent('light');

    await user.click(screen.getByRole('button', { name: 'Alternar' }));

    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
    expect(localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe('dark');
  });

  it('toggles dark -> light and persists it to localStorage', async () => {
    const user = userEvent.setup();
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, 'dark');
    render(<ColorModeProvider><Probe /></ColorModeProvider>);
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');

    await user.click(screen.getByRole('button', { name: 'Alternar' }));

    expect(screen.getByTestId('mode')).toHaveTextContent('light');
    expect(localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe('light');
  });

  it('throws a clear error when useColorMode is used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow('useColorMode debe usarse dentro de un ColorModeProvider.');
    spy.mockRestore();
  });
});
