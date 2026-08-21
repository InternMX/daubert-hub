import { createTheme } from '@mui/material/styles';

export const appTokens = {
  navigation: '#111111',
  navigationText: '#BDBDBD',
  navigationMuted: '#858585',
  navigationDivider: '#373737',
  navigationActive: 'rgba(255,255,255,0.08)',
  navigationHover: 'rgba(255,255,255,0.12)'
};

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#FEE01B', contrastText: '#020202' },
    error: { main: '#EB1A2D' },
    background: { default: '#F6F6F3', paper: '#FFFFFF' },
    text: { primary: '#171717', secondary: '#666666' },
    divider: '#DEDEDA'
  },
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
        containedPrimary: { '&:hover': { backgroundColor: '#E7CD00' }, '&.Mui-disabled': { backgroundColor: '#E7E7E3', color: '#777777' } }
      }
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiCssBaseline: { styleOverrides: { body: { minWidth: 320 } } }
  }
});
