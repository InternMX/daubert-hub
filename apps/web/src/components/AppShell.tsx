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
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import type { SvgIconComponent } from '@mui/icons-material';
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded';
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded';
import { AUTOMATION_ROUTE_BY_CODE, MANUFACTURING_SHEETS_ROUTE } from '../automations/automationRoutes';
import { useAuth } from '../auth/authContext.core';
import { getHealth, type RuntimeEnvironment } from '../services/health';
import { getSystemStatus, type SystemStatus } from '../services/systemStatus';
import { roleLabels } from '../services/userLabels';
import { appTokens, useColorMode } from '../theme';
import { SidebarContext } from './sidebarContext.core';

const logoUrl = 'https://daubertcromwell.com/wp-content/uploads/daubertcromwell_2lines.png';
const sidebarPreferenceKey = 'daubertHub.sidebarCollapsed';
const systemStatusPollIntervalMs = 30_000;
const expandedWidth = 256;
const collapsedWidth = 72;

const navigation: Array<{ to: string; label: string; end: boolean; icon: SvgIconComponent }> = [
  { to: '/', label: 'Inicio', end: true, icon: HomeRoundedIcon },
  { to: '/providers', label: 'Proveedores', end: false, icon: BusinessRoundedIcon },
  { to: '/clients', label: 'Clientes', end: false, icon: GroupsRoundedIcon },
  { to: '/contacts', label: 'Contactos', end: false, icon: ContactsRoundedIcon }
];

const usersNavigation = { to: '/users', label: 'Usuarios', end: false, icon: PeopleAltRoundedIcon };
const auditNavigation = { to: '/audit', label: 'Auditoría', end: false, icon: FactCheckRoundedIcon };

// The paths come from AUTOMATION_ROUTE_BY_CODE (shared with AutomationsPage.tsx) rather than
// being retyped here — the same string mismatch/staleness bug this file previously had for
// Caterpillar (a hardcoded, permanently-disabled "Sin integración" entry that never updated once
// Caterpillar shipped a real page and became INTEGRATED, Phase 12A.4d) can no longer happen for
// any of these three, since there is exactly one place that declares each route.
//
// Phase 12A.4e: "Panel general" removed — the parent "Automatizaciones" control itself now
// navigates directly to /automations (a split main-area/arrow interaction, see
// AutomationsNavigationItem below), so a redundant duplicate destination inside the submenu is no
// longer needed. Every automation page still links back to /automations via its own BreadcrumbNav.
const automationSubmenu = [
  { to: AUTOMATION_ROUTE_BY_CODE.REMISIONES_AUDI!, label: 'Remisiones Audi' },
  { to: AUTOMATION_ROUTE_BY_CODE.PAYMENT_NOTIFICATIONS!, label: 'Notificaciones de pago' },
  { to: AUTOMATION_ROUTE_BY_CODE.REMISIONES_CATERPILLAR!, label: 'Remisiones Caterpillar' },
  { to: MANUFACTURING_SHEETS_ROUTE, label: 'Hojas de manufactura' }
];

// Every automation matches its whole subtree (e.g. /automations/payment-notifications/:executionId
// still counts as that destination) — mirrors NavLink's own `end` semantics without needing a real
// NavLink for the current item. /automations itself (no submenu item represents it any more)
// correctly matches nothing here — the parent control is marked active by isActive below instead.
function currentSubmenuTo(pathname: string): string | null {
  const match = automationSubmenu.find((item) => pathname.startsWith(item.to));
  return match?.to ?? null;
}

const environmentPresentation: Record<RuntimeEnvironment, { label: string; compactLabel: string; color: 'error' | 'info' | 'warning'; variant: 'filled' | 'outlined'; title: string }> = {
  PRODUCTION: { label: 'PRODUCCIÓN', compactLabel: 'PROD', color: 'error', variant: 'filled', title: 'Daubert Hub · PROD' },
  TEST: { label: 'PRUEBAS', compactLabel: 'TEST', color: 'info', variant: 'outlined', title: 'Daubert Hub · TEST' },
  UNKNOWN: { label: 'ENTORNO DESCONOCIDO', compactLabel: '?', color: 'warning', variant: 'outlined', title: 'Daubert Hub · UNKNOWN' }
};

// 'UNKNOWN' = the status endpoint itself could not be read (not the same as n8n being down).
type N8nIndicatorState = SystemStatus['n8n']['status'] | 'UNKNOWN';

const n8nPresentation: Record<N8nIndicatorState, { label: string; color: string }> = {
  UP: { label: 'n8n conectado', color: 'success.main' },
  DOWN: { label: 'n8n no disponible', color: 'error.main' },
  NOT_CONFIGURED: { label: 'n8n sin configurar', color: 'warning.main' },
  UNKNOWN: { label: 'n8n sin verificar', color: 'grey.500' }
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

// Phase 12A.4e/12A.4g: a genuine split control, with no hover behavior of any kind (Phase 12A.4g
// removed it entirely — hovering the arrow while the mouse stayed put made the menu flicker
// open/closed in the real built UI, and no timer/grace-period/Popper complexity was judged worth
// it for this navigation item). MAIN AREA (the "Automatizaciones" text/icon row) is a real NavLink
// and always navigates to /automations on click, exactly like every other NavigationItem — never a
// disclosure control by itself. ARROW AREA is a separate, sibling <button> (never nested inside the
// NavLink's <a> — invalid HTML — and never inside the main ListItemButton either) that only
// opens/closes the submenu and always stops propagation, so a click on it can never bubble into and
// trigger the main link's navigation. A plain, deterministic click/keyboard toggle: click/Enter/
// Space opens it from closed, and click/Enter/Space again closes it — no other state to track.
//
// Collapsed: there is no room for a second control next to a single icon, so — unlike expanded
// mode — the icon stays a pure disclosure control (click/Enter/Space toggles the submenu, never
// navigates). /automations itself stays reachable while collapsed via each automation page's own
// BreadcrumbNav ("Automatizaciones" crumb), not via a submenu entry.
function AutomationsNavigationItem({ collapsed }: { collapsed: boolean }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);
  const pathname = useLocation().pathname;
  const isActive = pathname.startsWith('/automations');
  const currentTo = currentSubmenuTo(pathname);
  const toggleLabel = open ? 'Ocultar automatizaciones' : 'Mostrar automatizaciones';

  function closeMenu() {
    setAnchorEl(null);
  }
  // Arrow/collapsed-icon click or keyboard activation: the only way this menu ever opens or
  // closes now — open from closed, close from open.
  function toggleMenu(target: HTMLElement) {
    setAnchorEl((current) => (current ? null : target));
  }

  const menu = (
    <Menu
      id="automations-submenu"
      anchorEl={anchorEl}
      open={open}
      onClose={closeMenu}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ list: { 'aria-label': 'Submenú de Automatizaciones' } }}
    >
      {automationSubmenu.map((item) => {
        // CURRENT: readable, visibly selected, aria-current="page" — but never a navigable Link
        // (Phase 10F addendum: current and any future unavailable entry are genuinely different
        // states and must look and behave differently).
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
    </Menu>
  );

  if (collapsed) {
    return (
      <Box sx={{ position: 'relative' }}>
        <Tooltip title="Automatizaciones" placement="right">
          <IconButton
            aria-label="Automatizaciones"
            aria-haspopup="true"
            aria-controls={open ? 'automations-submenu' : undefined}
            aria-expanded={open || undefined}
            onClick={(event) => toggleMenu(event.currentTarget)}
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
    <Box sx={{ position: 'relative' }}>
      <Stack direction="row" alignItems="center">
        {/* MAIN AREA: always a direct link to /automations — no mouse handlers of any kind. */}
        <NavLink to="/automations" aria-label="Automatizaciones" onClick={closeMenu} style={{ color: 'inherit', textDecoration: 'none', flex: 1, minWidth: 0 }}>
          {({ isActive: linkActive }) => (
            <ListItemButton selected={linkActive} sx={{ minHeight: 44, borderLeft: '3px solid', borderLeftColor: linkActive ? 'primary.main' : 'transparent', color: linkActive ? 'common.white' : appTokens.navigationText, px: 2, '&.Mui-selected': { bgcolor: appTokens.navigationActive }, '&.Mui-selected:hover, &:hover': { bgcolor: appTokens.navigationHover }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }}>
              <ListItemIcon sx={{ color: 'inherit', minWidth: 40, justifyContent: 'center' }}><SettingsSuggestRoundedIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary="Automatizaciones" primaryTypographyProps={{ fontSize: 14, fontWeight: linkActive ? 700 : 500, noWrap: true }} />
            </ListItemButton>
          )}
        </NavLink>
        {/* ARROW AREA: a sibling of the NavLink above, never nested inside it — a real, separate
            <button>, click/keyboard only. */}
        <IconButton
          size="small"
          aria-label={toggleLabel}
          aria-haspopup="true"
          aria-controls={open ? 'automations-submenu' : undefined}
          aria-expanded={open || undefined}
          onClick={(event) => { event.stopPropagation(); toggleMenu(event.currentTarget); }}
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

// Small status dot + label. Purely informational: renders nothing until the first check resolves,
// and a failed check never blocks or throws — it just shows "sin verificar".
function N8nStatusIndicator({ status, collapsed }: { status: SystemStatus['n8n'] | 'UNKNOWN' | null; collapsed: boolean }) {
  if (!status) return null;
  const state: N8nIndicatorState = status === 'UNKNOWN' ? 'UNKNOWN' : status.status;
  const { label, color } = n8nPresentation[state];
  const details = status !== 'UNKNOWN' && status.status === 'UP' && status.latencyMs !== null ? ` · ${status.latencyMs} ms` : '';
  const checked = status !== 'UNKNOWN' && !Number.isNaN(new Date(status.checkedAt).getTime())
    ? ` · Última comprobación: ${new Date(status.checkedAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
    : '';

  return (
    <Tooltip title={`${label}${details}${checked}`} placement="right">
      <Box role="status" aria-label={label} sx={{ display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: 1, px: collapsed ? 0 : 1, mb: 1, cursor: 'default' }}>
        <Box aria-hidden data-testid="n8n-status-dot" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
        {!collapsed && <Typography noWrap variant="caption" color={appTokens.navigationText} sx={{ fontSize: '0.75rem' }}>{label}{details}</Typography>}
      </Box>
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
  const [n8nStatus, setN8nStatus] = useState<SystemStatus['n8n'] | 'UNKNOWN' | null>(null);
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

  // n8n availability: checked on mount, then roughly every 30s. Failures are swallowed (shown as
  // "sin verificar") and the timer + any in-flight request are always cleaned up on unmount.
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    function check() {
      getSystemStatus(controller.signal)
        .then((status) => { if (active) setN8nStatus(status.n8n); })
        .catch(() => { if (active) setN8nStatus('UNKNOWN'); });
    }
    check();
    const timer = setInterval(check, systemStatusPollIntervalMs);
    return () => {
      active = false;
      clearInterval(timer);
      controller.abort();
    };
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
              <NavigationItem {...auditNavigation} collapsed={collapsed} />
            </>
          )}
          <Divider sx={{ borderColor: appTokens.navigationDivider, my: 2 }} />
          <N8nStatusIndicator status={n8nStatus} collapsed={collapsed} />
          <AppearanceToggle collapsed={collapsed} />
          <UserAccountControl collapsed={collapsed} />
          <VersionFooter version={appVersion} commit={appCommit} collapsed={collapsed} />
        </Stack>
      </Box>
      <Box component="main" sx={{ minWidth: 0, px: { xs: 3, sm: 4, lg: 6 }, py: { xs: 4, md: 5 } }}>
        <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
          <SidebarContext.Provider value={{ collapsed }}>{children}</SidebarContext.Provider>
        </Box>
      </Box>
    </Box>
  );
}
