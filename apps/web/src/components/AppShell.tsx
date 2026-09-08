import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import ContactsRoundedIcon from '@mui/icons-material/ContactsRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import SettingsSuggestRoundedIcon from '@mui/icons-material/SettingsSuggestRounded';
import { Avatar, Box, Chip, Divider, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Stack, Tooltip, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import type { SvgIconComponent } from '@mui/icons-material';
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded';
import { useAuth } from '../auth/authContext.core';
import { getHealth, type RuntimeEnvironment } from '../services/health';
import { roleLabels } from '../services/userLabels';
import { appTokens } from '../theme';

const logoUrl = 'https://daubertcromwell.com/wp-content/uploads/daubertcromwell_2lines.png';
const sidebarPreferenceKey = 'daubertHub.sidebarCollapsed';
const expandedWidth = 256;
const collapsedWidth = 72;

const navigation: Array<{ to: string; label: string; end: boolean; icon: SvgIconComponent }> = [
  { to: '/', label: 'Inicio', end: true, icon: HomeRoundedIcon },
  { to: '/providers', label: 'Proveedores', end: false, icon: BusinessRoundedIcon },
  { to: '/clients', label: 'Clientes', end: false, icon: GroupsRoundedIcon },
  { to: '/contacts', label: 'Contactos', end: false, icon: ContactsRoundedIcon }
];

const automationNavigation = { to: '/automations', label: 'Automatizaciones', end: false, icon: SettingsSuggestRoundedIcon };
const usersNavigation = { to: '/users', label: 'Usuarios', end: false, icon: PeopleAltRoundedIcon };

const environmentPresentation: Record<RuntimeEnvironment, { label: string; compactLabel: string; color: 'error' | 'info' | 'warning'; variant: 'filled' | 'outlined'; title: string }> = {
  PRODUCTION: { label: 'PRODUCCIÓN', compactLabel: 'PROD', color: 'error', variant: 'filled', title: 'Daubert Hub · PROD' },
  TEST: { label: 'PRUEBAS', compactLabel: 'TEST', color: 'info', variant: 'outlined', title: 'Daubert Hub · TEST' },
  UNKNOWN: { label: 'ENTORNO DESCONOCIDO', compactLabel: '?', color: 'warning', variant: 'outlined', title: 'Daubert Hub · UNKNOWN' }
};

function storedPreference(): boolean | undefined {
  try {
    const stored = localStorage.getItem(sidebarPreferenceKey);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch { /* Fall back to the responsive default when storage is unavailable. */ }
  return undefined;
}

function NavigationItem({ to, label, end, icon: Icon, collapsed }: typeof navigation[number] & { collapsed: boolean }) {
  return (
    <Tooltip title={collapsed ? label : ''} placement="right">
      <NavLink to={to} end={end} aria-label={label} style={{ color: 'inherit', textDecoration: 'none' }}>
        {({ isActive }) => (
          <ListItemButton selected={isActive} sx={{ minHeight: 44, borderLeft: '3px solid', borderLeftColor: isActive ? 'primary.main' : 'transparent', color: isActive ? 'common.white' : appTokens.navigationText, justifyContent: collapsed ? 'center' : 'flex-start', px: collapsed ? 0 : 2, '&.Mui-selected': { bgcolor: appTokens.navigationActive }, '&.Mui-selected:hover, &:hover': { bgcolor: appTokens.navigationHover }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }}>
            <ListItemIcon sx={{ color: 'inherit', minWidth: collapsed ? 0 : 40, justifyContent: 'center' }}><Icon fontSize="small" /></ListItemIcon>
            {!collapsed && <ListItemText primary={label} primaryTypographyProps={{ fontSize: 14, fontWeight: isActive ? 700 : 500, noWrap: true }} />}
          </ListItemButton>
        )}
      </NavLink>
    </Tooltip>
  );
}

// Visually secondary, discreet — never as prominent as the environment
// chip. The Git commit is deliberately never shown in the normal UI, only
// in the tooltip, and only when the backend actually reports one.
function VersionFooter({ version, commit, collapsed }: { version: string | null; commit: string | null; collapsed: boolean }) {
  if (!version || collapsed) return null;

  const label = `v${version}`;
  const title = commit ? `${label} · ${commit}` : label;

  return (
    <Tooltip title={title} placement="right">
      <Typography noWrap variant="caption" color={appTokens.navigationMuted} sx={{ px: 1, mt: 1, display: 'block', fontSize: '0.6875rem', cursor: 'default' }}>
        {label}
      </Typography>
    </Tooltip>
  );
}

function UserIdentity({ collapsed }: { collapsed: boolean }) {
  const { user, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  if (!user) return null;

  async function handleLogout() {
    if (signingOut) return;
    setSigningOut(true);
    await logout();
  }

  const roleLabel = roleLabels[user.role];
  const initial = user.displayName.trim().charAt(0).toUpperCase() || '?';

  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ px: collapsed ? 0 : 1, justifyContent: collapsed ? 'center' : 'flex-start' }}>
      <Tooltip title={collapsed ? `${user.displayName} · ${roleLabel}` : ''} placement="right">
        <Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem', bgcolor: appTokens.navigationHover, color: 'common.white' }}>{initial}</Avatar>
      </Tooltip>
      {!collapsed && (
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap variant="body2" sx={{ color: 'common.white', fontWeight: 700, lineHeight: 1.3 }}>{user.displayName}</Typography>
          <Typography noWrap variant="caption" color={appTokens.navigationMuted}>{roleLabel}</Typography>
        </Box>
      )}
      <Tooltip title="Cerrar sesión" placement="right">
        <span>
          <IconButton aria-label="Cerrar sesión" size="small" color="inherit" disabled={signingOut} onClick={handleLogout}>
            <LogoutRoundedIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const theme = useTheme();
  const wideViewport = useMediaQuery(theme.breakpoints.up('lg'), { defaultMatches: true, noSsr: true });
  const initialPreference = storedPreference();
  const [hasExplicitPreference, setHasExplicitPreference] = useState(initialPreference !== undefined);
  const [collapsed, setCollapsed] = useState(initialPreference ?? !wideViewport);
  const [runtimeEnvironment, setRuntimeEnvironment] = useState<RuntimeEnvironment | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [appCommit, setAppCommit] = useState<string | null>(null);
  const sidebarWidth = collapsed ? collapsedWidth : expandedWidth;

  useEffect(() => {
    if (!hasExplicitPreference) setCollapsed(!wideViewport);
  }, [hasExplicitPreference, wideViewport]);

  useEffect(() => {
    let active = true;
    getHealth()
      .then((health) => {
        if (!active) return;
        setRuntimeEnvironment(health.environment);
        setAppVersion(health.version);
        setAppCommit(health.commit);
      })
      .catch(() => { if (active) setRuntimeEnvironment('UNKNOWN'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (runtimeEnvironment) document.title = environmentPresentation[runtimeEnvironment].title;
  }, [runtimeEnvironment]);

  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    setHasExplicitPreference(true);
    try { localStorage.setItem(sidebarPreferenceKey, String(next)); } catch { /* The in-memory preference still works. */ }
  }

  return (
    <Box data-testid="app-shell" data-sidebar-collapsed={collapsed ? 'true' : 'false'} sx={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)`, transition: theme.transitions.create('grid-template-columns', { duration: 200 }), bgcolor: 'background.default' }}>
      <Box id="primary-navigation" component="aside" aria-label="Navegación principal" sx={{ width: sidebarWidth, bgcolor: appTokens.navigation, color: 'common.white', px: collapsed ? 1 : 2, py: 2, display: 'flex', flexDirection: 'column', height: '100vh', position: 'sticky', top: 0, overflowX: 'hidden', overflowY: 'auto', transition: theme.transitions.create(['width', 'padding'], { duration: 200 }) }}>
        <Box sx={{ display: 'flex', justifyContent: collapsed ? 'center' : 'flex-end', mb: collapsed ? 2 : 1 }}>
          <Tooltip title={collapsed ? 'Expandir menú' : 'Contraer menú'} placement="right">
            <IconButton color="inherit" size="small" aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'} aria-expanded={!collapsed} aria-controls="primary-navigation" onClick={toggleSidebar}>
              {collapsed ? <ChevronRightRoundedIcon /> : <ChevronLeftRoundedIcon />}
            </IconButton>
          </Tooltip>
        </Box>
        {!collapsed && <Box sx={{ px: 1, mb: 1, maxWidth: 190 }}>
          <Box sx={{ bgcolor: 'common.white', p: 1.25, borderRadius: 0.5 }}>
            <Box component="img" src={logoUrl} alt="Daubert Cromwell" sx={{ display: 'block', width: '100%', height: 'auto' }} />
          </Box>
          <Typography variant="overline" sx={{ display: 'block', color: appTokens.navigationText, mt: 1.5 }}>Hub de operaciones</Typography>
        </Box>}
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 5, px: collapsed ? 0 : 1 }}>
          <Tooltip title={collapsed ? `Entorno: ${runtimeEnvironment ? environmentPresentation[runtimeEnvironment].label : 'Cargando'}` : ''} placement="right">
            <Chip
              aria-label={`Entorno: ${runtimeEnvironment ? environmentPresentation[runtimeEnvironment].label : 'Cargando'}`}
              label={runtimeEnvironment ? (collapsed ? environmentPresentation[runtimeEnvironment].compactLabel : environmentPresentation[runtimeEnvironment].label) : (collapsed ? '…' : 'CARGANDO…')}
              size="small"
              color={runtimeEnvironment ? environmentPresentation[runtimeEnvironment].color : 'default'}
              variant={runtimeEnvironment ? environmentPresentation[runtimeEnvironment].variant : 'outlined'}
              sx={{ maxWidth: '100%', fontWeight: 800, letterSpacing: '0.06em', fontSize: '0.625rem' }}
            />
          </Tooltip>
        </Box>
        <List disablePadding>
          {navigation.map((item, index) => (
            <Box key={item.to}>
              {index === 1 && !collapsed && <Box sx={{ px: 2, pt: 3, pb: 1 }}><Typography variant="overline" color={appTokens.navigationMuted}>Empresas</Typography></Box>}
              <NavigationItem {...item} collapsed={collapsed} />
            </Box>
          ))}
        </List>
        <Stack sx={{ mt: 'auto' }}>
          <Divider sx={{ borderColor: appTokens.navigationDivider, mb: 2 }} />
          {!collapsed && <Typography variant="overline" color={appTokens.navigationMuted} sx={{ px: 1, mb: 0.75 }}>Operación</Typography>}
          <NavigationItem {...automationNavigation} collapsed={collapsed} />
          {user?.role === 'ADMIN' && (
            <>
              {!collapsed && <Typography variant="overline" color={appTokens.navigationMuted} sx={{ px: 1, pt: 2, mb: 0.75 }}>Administración</Typography>}
              <NavigationItem {...usersNavigation} collapsed={collapsed} />
            </>
          )}
          <Divider sx={{ borderColor: appTokens.navigationDivider, my: 2 }} />
          <UserIdentity collapsed={collapsed} />
          <VersionFooter version={appVersion} commit={appCommit} collapsed={collapsed} />
        </Stack>
      </Box>
      <Box component="main" sx={{ minWidth: 0, px: { xs: 3, sm: 4, lg: 6 }, py: { xs: 4, md: 5 } }}>
        <Box sx={{ maxWidth: 1400, mx: 'auto' }}>{children}</Box>
      </Box>
    </Box>
  );
}
