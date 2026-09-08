import { render, screen } from '@testing-library/react';
import { Box, Button, Chip, CssBaseline, ThemeProvider, Typography } from '@mui/material';
import { Link, MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { buildTheme } from './theme';

// Focused on the one behavior that matters here: plain <a> elements (what
// react-router-dom's <Link> renders as, e.g. entity table links in
// Providers/Clients/Users) get a theme-aware, accessible color instead of
// the browser's default blue/purple — not a general audit of browser CSS.
function renderLink(mode: 'light' | 'dark') {
  const theme = buildTheme(mode);
  render(
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <a href="/providers/1">Proveedor de prueba</a>
    </ThemeProvider>
  );
  return theme;
}

// jsdom's getComputedStyle normalizes hex colors to rgb().
function toRgb(hex: string): string {
  const raw = hex.replace('#', '');
  // Handles both 3-char (e.g. MUI's dark-mode default text.primary, "#fff")
  // and 6-char hex.
  const value = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

describe('global link color (MuiCssBaseline)', () => {
  it('colors a plain <a> with the light-mode palette info.dark (a darker accessible blue), not the browser default', () => {
    const theme = renderLink('light');
    const link = screen.getByRole('link', { name: 'Proveedor de prueba' });
    expect(getComputedStyle(link).color).toBe(toRgb(theme.palette.info.dark));
  });

  it('colors a plain <a> with the dark-mode palette info.light (a lighter accessible blue)', () => {
    const theme = renderLink('dark');
    const link = screen.getByRole('link', { name: 'Proveedor de prueba' });
    expect(getComputedStyle(link).color).toBe(toRgb(theme.palette.info.light));
  });

  it('never uses a purple/violet visited-link color: the :visited rule pins the exact same color as the normal a{} rule', () => {
    const theme = renderLink('light');
    const stylesheetText = Array.from(document.styleSheets)
      .flatMap((sheet) => {
        try {
          return Array.from(sheet.cssRules).map((rule) => rule.cssText);
        } catch {
          return [];
        }
      })
      .join('\n');

    expect(stylesheetText).toContain(`a:not(.MuiButtonBase-root) {color: ${theme.palette.info.dark};}`);
    expect(stylesheetText).toContain(`a:not(.MuiButtonBase-root):visited {color: ${theme.palette.info.dark};}`);
  });

  it('keeps :focus-visible obvious with a visible outline', () => {
    const theme = renderLink('light');
    const stylesheetText = Array.from(document.styleSheets)
      .flatMap((sheet) => {
        try {
          return Array.from(sheet.cssRules).map((rule) => rule.cssText);
        } catch {
          return [];
        }
      })
      .join('\n');

    expect(stylesheetText).toContain(`a:not(.MuiButtonBase-root):focus-visible {outline: 2px solid ${theme.palette.primary.main}; outline-offset: 2px;}`);
  });

  it('gives the light and dark link colors distinct values (an actual mode-aware choice, not one hardcoded literal)', () => {
    const light = buildTheme('light');
    const dark = buildTheme('dark');
    expect(light.palette.info.dark).not.toBe(dark.palette.info.light);
  });

  it('does not override an anchor that already sets its own inline color — e.g. the sidebar NavLink pattern (color: inherit)', () => {
    const theme = buildTheme('light');
    render(
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <a href="/" style={{ color: 'inherit', textDecoration: 'none' }}>Inicio</a>
      </ThemeProvider>
    );
    const link = screen.getByRole('link', { name: 'Inicio' });
    // Inline style beats our global element-selector rule (higher CSS
    // specificity) — the inline "inherit" is still in effect, not the
    // theme's link color. (jsdom reports the un-resolved keyword rather
    // than the parent's actual color, which is enough to prove our rule
    // did not win.)
    expect(getComputedStyle(link).color).toBe('inherit');
    expect(getComputedStyle(link).color).not.toBe(theme.palette.info.dark);
  });
});

// Regression coverage for the bug fixed by `:not(.MuiButtonBase-root)`: a
// MUI Button rendered as a router link (e.g. "Nuevo proveedor", "Nuevo
// cliente", "Nuevo usuario", "Administrar" — all `<Button component={Link}
// .../>`) is still a plain <a> as far as CSS selectors are concerned. A
// bare `a:visited` rule (specificity 0,1,1) beats MUI's own single-class
// button color rule (specificity 0,1,0), so once such a link is :visited,
// the global link color would silently replace the button's dark contrast
// text — exactly what the screenshot in this task showed.
describe('router-backed MUI Buttons keep their own contrast text (not the global link color)', () => {
  function renderRouterButton(mode: 'light' | 'dark') {
    const theme = buildTheme(mode);
    render(
      <MemoryRouter>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <Button component={Link} to="/providers/new" variant="contained" color="primary">Nuevo proveedor</Button>
        </ThemeProvider>
      </MemoryRouter>
    );
    return theme;
  }

  it('a contained-primary Button rendered as a router <a> is excluded from the global anchor rule (class-based, not element-based, selector applies)', () => {
    renderRouterButton('light');
    const link = screen.getByRole('link', { name: 'Nuevo proveedor' });

    expect(link.tagName).toBe('A');
    expect(link).toHaveClass('MuiButtonBase-root');
    // The color comes from MUI's own class rule (--variant-containedColor),
    // never a literal value from our global `a` rule — jsdom doesn't
    // resolve CSS custom properties via getComputedStyle, so seeing the
    // unresolved var() here (rather than our link-blue hex) is exactly the
    // proof that our rule did not set `color` on this element at all.
    expect(getComputedStyle(link).color).toBe('var(--variant-containedColor)');
  });

  it('does not apply :visited styling to a router-backed Button in either mode', () => {
    for (const mode of ['light', 'dark'] as const) {
      const theme = renderRouterButton(mode);
      const rules = Array.from(document.styleSheets)
        .flatMap((sheet) => {
          try {
            return Array.from(sheet.cssRules).map((rule) => rule.cssText);
          } catch {
            return [];
          }
        });

      // The :visited rule for text links exists (for genuine text links
      // elsewhere on the page) but is scoped away from MuiButtonBase-root —
      // it must never appear as a bare, unqualified `a:visited { ... }`
      // rule, which is exactly what would also match a router-backed Button.
      const bareVisitedRule = rules.find((rule) => rule.startsWith('a:visited'));
      expect(bareVisitedRule).toBeUndefined();
      expect(theme.palette.primary.contrastText).toBe('#020202');
    }
  });

  it('sanity: the excluding selector is present in the injected stylesheet', () => {
    renderRouterButton('light');
    const stylesheetText = Array.from(document.styleSheets)
      .flatMap((sheet) => {
        try {
          return Array.from(sheet.cssRules).map((rule) => rule.cssText);
        } catch {
          return [];
        }
      })
      .join('\n');

    expect(stylesheetText).toContain('a:not(.MuiButtonBase-root)');
  });
});

describe('outlined-primary contrast (MuiButton / MuiChip)', () => {
  it('light mode: an outlined-primary Button uses dark readable text, with the yellow kept only as the border', () => {
    const theme = buildTheme('light');
    render(<ThemeProvider theme={theme}><CssBaseline /><Button variant="outlined" color="primary">Volver</Button></ThemeProvider>);

    const button = screen.getByRole('button', { name: 'Volver' });
    expect(getComputedStyle(button).color).toBe(toRgb(theme.palette.text.primary));
    expect(getComputedStyle(button).color).not.toBe(toRgb(theme.palette.primary.main));
    expect(getComputedStyle(button).borderColor).toBe(toRgb(theme.palette.primary.main));
  });

  it('dark mode: an outlined-primary Button keeps yellow text — it already reads fine against a dark background', () => {
    const theme = buildTheme('dark');
    render(<ThemeProvider theme={theme}><CssBaseline /><Button variant="outlined" color="primary">Volver</Button></ThemeProvider>);

    const button = screen.getByRole('button', { name: 'Volver' });
    expect(getComputedStyle(button).color).toBe(toRgb(theme.palette.primary.main));
    expect(getComputedStyle(button).borderColor).toBe(toRgb(theme.palette.primary.main));
  });

  it('light mode: an outlined-primary Chip (e.g. a role Chip) uses dark readable text with a yellow border', () => {
    const theme = buildTheme('light');
    render(<ThemeProvider theme={theme}><CssBaseline /><Chip label="Rol" variant="outlined" color="primary" /></ThemeProvider>);

    const chip = screen.getByText('Rol');
    expect(getComputedStyle(chip).color).toBe(toRgb(theme.palette.text.primary));
  });

  it('a filled-primary Chip (the ADMIN role Chip) keeps a dark contrastText on the yellow fill, unchanged', () => {
    const theme = buildTheme('light');
    render(<ThemeProvider theme={theme}><CssBaseline /><Chip label="Administrador" variant="filled" color="primary" /></ThemeProvider>);

    const chip = screen.getByText('Administrador').closest('.MuiChip-root') as HTMLElement;
    expect(getComputedStyle(chip).backgroundColor).toBe(toRgb(theme.palette.primary.main));
    expect(getComputedStyle(chip).color).toBe(toRgb(theme.palette.primary.contrastText));
  });

  it('a contained-primary Button (e.g. the active Recent Activity filter) keeps dark contrastText on the yellow fill, unchanged', () => {
    // This MUI version resolves contained Button colors through CSS custom
    // properties (--variant-containedBg/-Color) that jsdom doesn't resolve
    // via getComputedStyle — a pre-existing, unrelated MUI/jsdom detail, not
    // something this fix touches. Asserted directly against the theme
    // config instead, which is what actually determines the rendered color.
    const theme = buildTheme('light');
    expect(theme.palette.primary.main).toBe('#FEE01B');
    expect(theme.palette.primary.contrastText).toBe('#020202');
  });
});

// Regression coverage for the Contacts company selector: a native <button>
// element (`<Box component="button">`, used by the company row so the
// whole row is clickable/keyboard-accessible) does not inherit the ambient
// theme text color the way ordinary elements do — browsers give unstyled
// text inside a <button> the UA system color `buttontext`, which renders
// dark/black regardless of the surrounding dark-mode page. A Typography
// with no explicit `color` inside such a button silently picks that up
// instead of the theme's text.primary — exactly the confirmed bug
// ("A&N", "Acuario Imprenta", etc. rendering as dark text on a dark
// background). The fix is an explicit `color="text.primary"`, not a
// mode === 'dark' branch — this proves that token resolves correctly in
// both modes and actually reaches the rendered element.
describe('Contacts company list contrast (Typography color inside a native <button>)', () => {
  function renderCompanyRow(mode: 'light' | 'dark', explicitColor: boolean) {
    const theme = buildTheme(mode);
    render(
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box component="button" type="button">
          <Typography fontWeight={700} color={explicitColor ? 'text.primary' : undefined}>Acuario Imprenta</Typography>
        </Box>
      </ThemeProvider>
    );
    return theme;
  }

  it('reproduces the bug: without an explicit color, text inside a native <button> does not pick up the theme text color', () => {
    renderCompanyRow('dark', false);
    const name = screen.getByText('Acuario Imprenta');
    // The browser's UA button-text keyword, not the theme's near-white
    // dark-mode text.primary — this is the confirmed regression.
    expect(getComputedStyle(name).color).toBe('buttontext');
  });

  it('fixed: color="text.primary" resolves to the light-mode dark text color', () => {
    const theme = renderCompanyRow('light', true);
    const name = screen.getByText('Acuario Imprenta');
    expect(getComputedStyle(name).color).toBe(toRgb(theme.palette.text.primary));
  });

  it('fixed: color="text.primary" resolves to the dark-mode near-white text color', () => {
    const theme = renderCompanyRow('dark', true);
    const name = screen.getByText('Acuario Imprenta');
    expect(getComputedStyle(name).color).toBe(toRgb(theme.palette.text.primary));
    expect(theme.palette.text.primary).not.toBe('buttontext');
  });
});
