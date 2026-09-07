import { Box, CircularProgress } from '@mui/material';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation, type Location } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAuth } from './authContext.core';

export function LoadingScreen() {
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <CircularProgress aria-label="Cargando sesión" />
    </Box>
  );
}

interface LocationState {
  from?: Location;
}

// Guards the application's business routes. Unauthenticated visitors are sent
// to /login (preserving the originally requested location); a session whose
// user still has mustChangePassword=true is sent to /change-password instead
// of ever reaching AppShell/normal navigation.
export function ProtectedLayout() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace state={{ from: location } satisfies LocationState} />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

// /login itself: an authenticated user visiting it is bounced back into the
// application (or to /change-password if that is still pending) instead of
// seeing the login form again.
export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <LoadingScreen />;
  if (user) {
    if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
    const from = (location.state as LocationState | null)?.from;
    return <Navigate to={from ? `${from.pathname}${from.search}` : '/'} replace />;
  }

  return <>{children}</>;
}

// /change-password: only reachable by an authenticated user who still must
// change their password. Anyone else is redirected away — including, after a
// successful change, back into the normal application.
export function ChangePasswordRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.mustChangePassword) return <Navigate to="/" replace />;

  return <>{children}</>;
}
