import { createTheme, type PaletteOptions, type Theme } from '@mui/material/styles';
import type { ColorMode } from './colorMode.core';

// The primary navigation (sidebar) is deliberately NOT part of the
// light/dark palette — it stays a fixed, near-black corporate surface in
// both modes (see AppShell.tsx), so these values never change with mode.
export const appTokens = {
  navigation: '#111111',
  navigationText: '#BDBDBD',
  navigationMuted: '#858585',
  navigationDivider: '#373737',
  navigationActive: 'rgba(255,255,255,0.08)',
  navigationHover: 'rgba(255,255,255,0.12)'
};

// Light mode keeps the original, deliberately tuned corporate palette.
// Dark mode intentionally does NOT re-invent background/text/divider values:
// MUI's own dark-mode defaults (a very dark gray page, a slightly lighter
// gray Paper, near-white primary text, a muted secondary text, a subtle
// divider) already are exactly this restrained look, and are already
// contrast-tested — only the corporate accent colors are pinned per mode,
// via semantic palette slots (primary/error) rather than scattered
// `mode === 'dark' ? ... : ...` checks throughout the component tree.
function paletteFor(mode: ColorMode): PaletteOptions {
  const corporate: PaletteOptions = {
    mode,
    primary: { main: '#FEE01B', contrastText: '#020202' },
    // Dark mode uses a slightly lighter, warmer red: the same saturated red
    // used against light backgrounds loses contrast against a near-black
    // page — this keeps the "restrained red" corporate identity while
    // staying readable.
    error: { main: mode === 'dark' ? '#FF6B5E' : '#EB1A2D' }
  };

  if (mode === 'dark') return corporate;

  return {
    ...corporate,
    background: { default: '#F6F6F3', paper: '#FFFFFF' },
    text: { primary: '#171717', secondary: '#666666' },
    divider: '#DEDEDA'
  };
}

export function buildTheme(mode: ColorMode): Theme {
  return createTheme({
    palette: paletteFor(mode),
    typography: {
      fontFamily: 'Arial, "Helvetica Neue", sans-serif',
      h1: { fontSize: '2.125rem', fontWeight: 700, lineHeight: 1.18, letterSpacing: '-0.025em' },
      h2: { fontSize: '1.375rem', fontWeight: 700, lineHeight: 1.3 },
      subtitle1: { fontSize: '1rem', lineHeight: 1.55 },
      body1: { fontSize: '0.9375rem', lineHeight: 1.55 },
      body2: { fontSize: '0.8125rem', lineHeight: 1.5 },
      overline: { fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.1em', lineHeight: 1.5 }
    },
    shape: { borderRadius: 6 },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 4, fontWeight: 700, textTransform: 'none', minHeight: 38, paddingInline: 16 },
          containedPrimary: {
            '&:hover': { backgroundColor: mode === 'dark' ? '#D8B900' : '#E7CD00' },
            // A light-gray disabled button (the light-mode value) would read
            // as a jarring bright patch against a dark page — this is the
            // one confirmed hardcoded light-only value in the theme itself.
            '&.Mui-disabled': { backgroundColor: mode === 'dark' ? '#3A3A3A' : '#E7E7E3', color: mode === 'dark' ? '#8A8A8A' : '#777777' }
          }
        }
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiCssBaseline: { styleOverrides: { body: { minWidth: 320 } } }
    }
  });
}
