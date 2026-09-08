import { CssBaseline, ThemeProvider } from '@mui/material';
import { useMemo, useState, type ReactNode } from 'react';
import { ColorModeContext, readStoredColorMode, writeStoredColorMode, type ColorMode } from './colorMode.core';
import { buildTheme } from './theme';

// Application-level provider — rendered above routing/auth in main.tsx so
// the saved appearance preference already applies on /login, before any
// session is known (see App-level composition in main.tsx). This is the
// single MUI ThemeProvider for the whole app; there is no second theme
// implementation anywhere else.
export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ColorMode>(() => readStoredColorMode());
  const theme = useMemo(() => buildTheme(mode), [mode]);

  function toggleColorMode() {
    setMode((current) => {
      const next: ColorMode = current === 'dark' ? 'light' : 'dark';
      writeStoredColorMode(next);
      return next;
    });
  }

  return (
    <ColorModeContext.Provider value={{ mode, toggleColorMode }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}
