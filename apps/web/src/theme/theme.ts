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
          },
          // Corporate yellow is an accent/background color, never body text
          // on a light surface — MUI's own outlined-primary default (yellow
          // text + yellow border, on a transparent/white background in
          // light mode) fails contrast. The border stays yellow (still a
          // clear, corporate-colored affordance); only the TEXT swaps to a
          // readable color. In dark mode the same yellow text already reads
          // fine against the dark transparent background, so it's left
          // alone there — this is exactly the Recent Activity "inactive
          // filter" and any other outlined-primary Button (e.g. "Volver a
          // proveedores", "Restablecer contraseña") across the app.
          outlinedPrimary: ({ theme }) => ({
            color: theme.palette.mode === 'dark' ? theme.palette.primary.main : theme.palette.text.primary,
            borderColor: theme.palette.primary.main,
            '&:hover': { borderColor: theme.palette.primary.main }
          })
        }
      },
      MuiChip: {
        styleOverrides: {
          // Same rule as MuiButton.outlinedPrimary above — see that comment.
          // Chip's filledPrimary (used by the ADMIN role Chip) is left
          // alone: it already uses primary.contrastText automatically,
          // which is the correct dark, readable text on the yellow fill.
          outlinedPrimary: ({ theme }) => ({
            color: theme.palette.mode === 'dark' ? theme.palette.primary.main : theme.palette.text.primary,
            borderColor: theme.palette.primary.main
          })
        }
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiCssBaseline: {
        styleOverrides: (theme) => {
          // Global, semantic link color for plain textual <a> elements that
          // don't set their own color — this is exactly react-router-dom's
          // <Link>, which entity tables (Providers/Clients/Users) render as
          // a bare anchor with no MUI styling, so it otherwise falls
          // through to the browser's default blue/purple (including a
          // poor-contrast dark-purple :visited state on a dark background).
          // Derived from the theme's own `info` palette slot rather than a
          // new hardcoded color: `info.dark` (light mode) / `info.light`
          // (dark mode) are already accessible, theme-consistent blues
          // meant for exactly this "read against the page background"
          // role, and stay correct automatically if the palette ever
          // changes.
          //
          // `:not(.MuiButtonBase-root)` is load-bearing, not decorative: a
          // MUI Button/IconButton rendered as a router link (e.g.
          // `<Button component={Link} .../>`, used by "Nuevo proveedor",
          // "Nuevo cliente", "Nuevo usuario", "Administrar") is still a
          // plain <a> element as far as CSS is concerned, and its own
          // color comes from a single class selector (e.g.
          // `.MuiButton-containedPrimary`, specificity 0,1,0). A bare
          // `a:visited` selector has specificity 0,1,1 — one level HIGHER
          // — so once such a link is :visited, our rule would silently win
          // and replace the button's dark contrast text with this blue,
          // exactly the regression this comment now guards against.
          // Excluding `.MuiButtonBase-root` (present on every Button/
          // IconButton, link-rendered or not) makes this rule apply only
          // to genuine textual links, never to button-like controls,
          // regardless of specificity math. The sidebar's NavLink is
          // already safe independently: it sets `color: inherit` via
          // inline style, the highest-specificity origin there is.
          const linkColor = theme.palette.mode === 'dark' ? theme.palette.info.light : theme.palette.info.dark;
          const textLinkSelector = 'a:not(.MuiButtonBase-root)';
          return {
            body: { minWidth: 320 },
            [textLinkSelector]: { color: linkColor },
            // :visited has higher specificity than a bare `a` selector, so
            // without this the browser's default purple would still win —
            // pin it to the exact same color as the normal state.
            [`${textLinkSelector}:visited`]: { color: linkColor },
            [`${textLinkSelector}:focus-visible`]: { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 }
          };
        }
      }
    }
  });
}
