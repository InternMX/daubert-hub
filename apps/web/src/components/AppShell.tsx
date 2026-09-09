import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import ContactsRoundedIcon from '@mui/icons-material/ContactsRounded';
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import SettingsSuggestRoundedIcon from '@mui/icons-material/SettingsSuggestRounded';
import { Avatar, Box, ButtonBase, Chip, Divider, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Menu, MenuItem, Stack, Tooltip, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import type { SvgIconComponent } from '@mui/icons-material';
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded';
import { useAuth } from '../auth/authContext.core';
import { getHealth, type RuntimeEnvironment } from '../services/health';
import { roleLabels } from '../services/userLabels';
import { appTokens, useColorMode } from '../theme';

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

const usersNavigation = { to: '/users', label: 'Usuarios', end: false, icon: PeopleAltRoundedIcon };

const automationSubmenu = [
  { to: '/automations', label: 'Panel general' },
  { to: '/automations/remissions/audi', label: 'Remisiones Audi' },
  { to: '/automations/payment-notifications', label: 'Notificaciones de pago' }
];

// Panel general only matches the exact route; Audi and Payment Notifications match their whole
// subtree (e.g. /automations/payment-notifications/:executionId still counts as that destination)
// — mirrors NavLink's own `end` semantics without needing a real NavLink for the current item.
function currentSubmenuTo(pathname: string): string | null {
  if (pathname === '/automations') return '/automations';
  if (pathname.startsWith('/automations/remissions/audi')) return '/automations/remissions/audi';
  if (pathname.startsWith('/automations/payment-notifications')) return '/automations/payment-notifications';
  return null;
}

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

// Expanded: "Automatizaciones" is both a direct link (clicking the row navigates to /automations,
// exactly like every other NavigationItem) and a disclosure control for its submenu — a chevron
// button opens a MUI Menu, mirroring UserAccountControl's own Menu-anchored-to-a-button pattern
// below. Collapsed: there is no room for a separate chevron, so the icon itself becomes a pure
// disclosure control (click/Enter/Space opens the submenu — never a direct navigation), and
// "Panel general" inside that submenu is how /automations stays reachable — this is the required
// accessible alternative to a "tiny collapsed-state chevron" (Phase 10E §28). In both states, hover
// opens the menu as a convenience enhancement only, never the sole mechanism: keyboard users Tab
// to a real <button> and press Enter/Space, which fires the same onClick a click would. The menu
// is never opened purely by receiving focus, so MUI's own restoreFocus-on-close (which returns
// focus to the trigger after Escape/selection) can never reopen it in a loop.
function AutomationsNavigationItem({ collapsed }: { collapsed: boolean }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const closeTimer = useRef<number | null>(null);
  const open = Boolean(anchorEl);
  const pathname = useLocation().pathname;
  const isActive = pathname.startsWith('/automations');
  const currentTo = currentSubmenuTo(pathname);

  function clearCloseTimer() {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }
  function openMenu(target: HTMLElement) {
    clearCloseTimer();
    setAnchorEl(target);
  }
  function scheduleClose() {
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => setAnchorEl(null), 150);
  }
  function closeMenu() {
    clearCloseTimer();
    setAnchorEl(null);
  }

  const menu = (
    <Menu
      id="automations-submenu"
      anchorEl={anchorEl}
      open={open}
      onClose={closeMenu}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ list: { onMouseEnter: clearCloseTimer, onMouseLeave: scheduleClose, 'aria-label': 'Submenú de Automatizaciones' } }}
    >
      {automationSubmenu.map((item) => {
        // CURRENT: readable, visibly selected, aria-current="page" — but never a navigable Link
        // and never rendered/treated like the disabled Caterpillar entry below (Phase 10F addendum:
        // current and unavailable are genuinely different states and must look and behave differently).
        if (item.to === currentTo) {
          return (
            <MenuItem
              key={item.to}
              aria-current="page"
              selected
              disableRipple
              onClick={closeMenu}
              sx={{ borderLeft: '3px solid', borderLeftColor: 'primary.main', fontWeight: 700, cursor: 'default' }}
            >
              {item.label}
            </MenuItem>
          );
        }
        return <MenuItem key={item.to} component={Link} to={item.to} onClick={closeMenu}>{item.label}</MenuItem>;
      })}
      {/* Caterpillar has no Hub route (Phase 10E §18/§20) — shown disabled rather than omitted, so
          its existence stays visible without ever navigating anywhere or inventing a route. */}
      <MenuItem disabled>
        <Box>
          <Typography variant="body2">Remisiones Caterpillar</Typography>
          <Typography variant="caption" color="text.secondary">Sin integración</Typography>
        </Box>
      </MenuItem>
    </Menu>
  );

  if (collapsed) {
    return (
      <Box onMouseEnter={(event) => openMenu(event.currentTarget)} onMouseLeave={scheduleClose} sx={{ position: 'relative' }}>
        <Tooltip title="Automatizaciones" placement="right">
          <IconButton
            aria-label="Automatizaciones"
            aria-haspopup="true"
            aria-controls={open ? 'automations-submenu' : undefined}
            aria-expanded={open || undefined}
            onClick={(event) => openMenu(event.currentTarget)}
            sx={{ width: '100%', minHeight: 44, borderRadius: 1, color: isActive ? 'common.white' : appTokens.navigationText, '&:hover': { bgcolor: appTokens.navigationHover }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }}
          >
            <SettingsSuggestRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {menu}
      </Box>
    );
  }

  return (
    <Box onMouseEnter={(event) => openMenu(event.currentTarget)} onMouseLeave={scheduleClose} sx={{ position: 'relative' }}>
      <Stack direction="row" alignItems="center">
        <NavLink to="/automations" aria-label="Automatizaciones" onClick={closeMenu} style={{ color: 'inherit', textDecoration: 'none', flex: 1, minWidth: 0 }}>
          {({ isActive: linkActive }) => (
            <ListItemButton selected={linkActive} sx={{ minHeight: 44, borderLeft: '3px solid', borderLeftColor: linkActive ? 'primary.main' : 'transparent', color: linkActive ? 'common.white' : appTokens.navigationText, px: 2, '&.Mui-selected': { bgcolor: appTokens.navigationActive }, '&.Mui-selected:hover, &:hover': { bgcolor: appTokens.navigationHover }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }}>
              <ListItemIcon sx={{ color: 'inherit', minWidth: 40, justifyContent: 'center' }}><SettingsSuggestRoundedIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary="Automatizaciones" primaryTypographyProps={{ fontSize: 14, fontWeight: linkActive ? 700 : 500, noWrap: true }} />
            </ListItemButton>
          )}
        </NavLink>
        <IconButton
          size="small"
          aria-label="Mostrar submenú de Automatizaciones"
          aria-haspopup="true"
          aria-controls={open ? 'automations-submenu' : undefined}
          aria-expanded={open || undefined}
          onClick={(event) => openMenu(event.currentTarget)}
          sx={{ color: isActive ? 'common.white' : appTokens.navigationText, mr: 1 }}
        >
          <ExpandMoreRoundedIcon fontSize="small" />
        </IconButton>
      </Stack>
      {menu}
    </Box>
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

// Icon-only, tooltip-labeled — mirrors the collapse/expand control at the
// top of the sidebar (same pattern: no visible text, just an icon +
// tooltip/aria-label), which keeps it visually secondary to the more
// prominent account control (avatar, name, role, account menu) right below it.
// Renders identically whether the sidebar is collapsed or expanded, so
// there is no separate collapsed-only/expanded-only behavior to keep in sync.
function AppearanceToggle({ collapsed }: { collapsed: boolean }) {
  const { mode, toggleColorMode } = useColorMode();
  const isDark = mode === 'dark';
  const label = isDark ? 'Activar modo claro' : 'Activar modo oscuro';

  return (
    <Box sx={{ display: 'flex', justifyContent: collapsed ? 'center' : 'flex-start', px: collapsed ? 0 : 1, mb: 1 }}>
      <Tooltip title={label} placement="right">
        <IconButton aria-label={label} size="small" color="inherit" onClick={toggleColorMode}>
          {isDark ? <LightModeRoundedIcon fontSize="small" /> : <DarkModeRoundedIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
    </Box>
  );
}

// The whole identity row is a single accessible control (ButtonBase renders
// a real <button>, so Enter/Space/focus work natively with no extra
// handling) that opens an account menu — replacing the old side-by-side
// avatar + standalone logout icon, which had no room to breathe in the
// narrow collapsed sidebar. Collapsed mode shows only the centered avatar,
// with the identity available via tooltip and via opening the menu.
function UserAccountControl({ collapsed }: { collapsed: boolean }) {
  const { user, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const menuOpen = Boolean(anchorEl);

  if (!user) return null;

  function handleOpen(event: MouseEvent<HTMLElement>) {
    setAnchorEl(event.currentTarget);
  }

  function handleClose() {
    setAnchorEl(null);
  }

  async function handleLogout() {
    if (signingOut) return;
    setSigningOut(true);
    await logout();
  }

  const roleLabel = roleLabels[user.role];
  const initial = user.displayName.trim().charAt(0).toUpperCase() || '?';

  return (
    <>
      <Tooltip title={collapsed ? `${user.displayName} · ${roleLabel}` : ''} placement="right">
        <ButtonBase
          id="account-menu-button"
          aria-label="Cuenta de usuario"
          aria-haspopup="true"
          aria-controls={menuOpen ? 'account-menu' : undefined}
          aria-expanded={menuOpen || undefined}
          onClick={handleOpen}
          sx={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            textAlign: 'left',
            color: 'inherit',
            borderRadius: 1,
            px: collapsed ? 0 : 1,
            py: 0.5,
            justifyContent: collapsed ? 'center' : 'flex-start',
            '&:hover': { bgcolor: appTokens.navigationHover },
            '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 }
          }}
        >
          <Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem', bgcolor: appTokens.navigationHover, color: 'common.white' }}>{initial}</Avatar>
          {!collapsed && (
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography noWrap variant="body2" sx={{ color: 'common.white', fontWeight: 700, lineHeight: 1.3 }}>{user.displayName}</Typography>
              <Typography noWrap variant="caption" color={appTokens.navigationMuted}>{roleLabel}</Typography>
            </Box>
          )}
        </ButtonBase>
      </Tooltip>
      <Menu
        id="account-menu"
        anchorEl={anchorEl}
        open={menuOpen}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ list: { 'aria-labelledby': 'account-menu-button' } }}
      >
        <Box sx={{ px: 2, pt: 0.5, pb: 1, minWidth: 200, maxWidth: 280 }}>
          <Typography noWrap variant="subtitle2" sx={{ fontWeight: 700 }}>{user.displayName}</Typography>
          <Typography noWrap variant="body2" color="text.secondary">{user.email}</Typography>
          <Typography variant="caption" color="text.secondary">{roleLabel}</Typography>
        </Box>
        <Divider />
        <MenuItem onClick={handleLogout} disabled={signingOut}>
          <ListItemIcon><LogoutRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Cerrar sesión</ListItemText>
        </MenuItem>
      </Menu>
    </>
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
          <AutomationsNavigationItem collapsed={collapsed} />
          {user?.role === 'ADMIN' && (
            <>
              {!collapsed && <Typography variant="overline" color={appTokens.navigationMuted} sx={{ px: 1, pt: 2, mb: 0.75 }}>Administración</Typography>}
              <NavigationItem {...usersNavigation} collapsed={collapsed} />
            </>
          )}
          <Divider sx={{ borderColor: appTokens.navigationDivider, my: 2 }} />
          <AppearanceToggle collapsed={collapsed} />
          <UserAccountControl collapsed={collapsed} />
          <VersionFooter version={appVersion} commit={appCommit} collapsed={collapsed} />
        </Stack>
      </Box>
      <Box component="main" sx={{ minWidth: 0, px: { xs: 3, sm: 4, lg: 6 }, py: { xs: 4, md: 5 } }}>
        <Box sx={{ maxWidth: 1400, mx: 'auto' }}>{children}</Box>
      </Box>
    </Box>
  );
}
