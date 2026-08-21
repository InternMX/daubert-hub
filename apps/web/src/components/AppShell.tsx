import { Box, Divider, List, ListItemButton, ListItemText, Stack, Typography } from '@mui/material';
import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { appTokens } from '../theme';

const logoUrl = 'https://daubertcromwell.com/wp-content/uploads/daubertcromwell_2lines.png';

const navigation = [
  { to: '/', label: 'Inicio', end: true },
  { to: '/providers', label: 'Proveedores', end: false },
  { to: '/contacts', label: 'Contactos', end: false }
];

function NavigationItem({ to, label, end }: typeof navigation[number]) {
  if (!to || !label) return null;
  return (
    <NavLink to={to} end={end} style={{ color: 'inherit', textDecoration: 'none' }}>
      {({ isActive }) => (
        <ListItemButton selected={isActive} sx={{ borderLeft: '3px solid', borderLeftColor: isActive ? 'primary.main' : 'transparent', color: isActive ? 'common.white' : appTokens.navigationText, pl: 2, '&.Mui-selected': { bgcolor: appTokens.navigationActive }, '&.Mui-selected:hover, &:hover': { bgcolor: appTokens.navigationHover }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }}>
          <ListItemText primary={label} primaryTypographyProps={{ fontSize: 14, fontWeight: isActive ? 700 : 500 }} />
        </ListItemButton>
      )}
    </NavLink>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '256px minmax(0, 1fr)' }, bgcolor: 'background.default' }}>
      <Box component="aside" aria-label="Navegación principal" sx={{ bgcolor: appTokens.navigation, color: 'common.white', px: 2, py: 3, display: 'flex', flexDirection: 'column', minHeight: { md: '100vh' } }}>
        <Box sx={{ px: 1, mb: { xs: 2, md: 5 }, maxWidth: 190 }}>
          <Box sx={{ bgcolor: 'common.white', p: 1.25, borderRadius: 0.5 }}>
            <Box component="img" src={logoUrl} alt="Daubert Cromwell" sx={{ display: 'block', width: '100%', height: 'auto' }} />
          </Box>
          <Typography variant="overline" sx={{ display: 'block', color: appTokens.navigationText, mt: 1.5 }}>Hub de operaciones</Typography>
        </Box>
        <List disablePadding sx={{ display: { xs: 'grid', md: 'block' }, gridTemplateColumns: { xs: 'repeat(3, minmax(0, 1fr))' } }}>
          {navigation.map((item, index) => (
            <Box key={item.to} sx={{ display: 'contents' }}>
              {index === 1 && <Box sx={{ display: { xs: 'none', md: 'block' }, px: 2, pt: 3, pb: 1 }}><Typography variant="overline" color={appTokens.navigationMuted}>Directorio</Typography></Box>}
              <NavigationItem {...item} />
            </Box>
          ))}
        </List>
        <Stack sx={{ mt: 'auto', display: { xs: 'none', md: 'flex' } }}>
          <Divider sx={{ borderColor: appTokens.navigationDivider, mb: 2 }} />
          <Typography variant="overline" color={appTokens.navigationMuted} sx={{ px: 1 }}>Administración</Typography>
          <Typography variant="body2" color={appTokens.navigationText} sx={{ px: 1, mt: 0.75 }}>Próximamente</Typography>
        </Stack>
      </Box>
      <Box component="main" sx={{ minWidth: 0, px: { xs: 3, sm: 4, lg: 6 }, py: { xs: 4, md: 5 } }}>
        <Box sx={{ maxWidth: 1400, mx: 'auto' }}>{children}</Box>
      </Box>
    </Box>
  );
}
