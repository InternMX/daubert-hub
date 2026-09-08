import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { ChangePasswordPage } from './auth/ChangePasswordPage';
import { LoginPage } from './auth/LoginPage';
import { AdminRoute, ChangePasswordRoute, ProtectedLayout, PublicOnlyRoute } from './auth/RouteGuards';
import { useAuth } from './auth/authContext.core';
import { RecentActivity } from './components/RecentActivity';
import { NewProviderPage } from './providers/NewProviderPage';
import { ProviderDetailPage } from './providers/ProviderDetailPage';
import { EditProviderPage } from './providers/EditProviderPage';
import { ProvidersPage } from './providers/ProvidersPage';
import { NewClientPage } from './clients/NewClientPage';
import { ClientDetailPage } from './clients/ClientDetailPage';
import { EditClientPage } from './clients/EditClientPage';
import { ClientsPage } from './clients/ClientsPage';
import { ContactsPage } from './contacts/ContactsPage';
import { AutomationsPage } from './automations/AutomationsPage';
import { AudiRemissionsPage } from './automations/AudiRemissionsPage';
import { UsersPage } from './users/UsersPage';
import { NewUserPage } from './users/NewUserPage';
import { UserDetailPage } from './users/UserDetailPage';
import { EditUserPage } from './users/EditUserPage';
import { roleLabels } from './services/userLabels';

function HomePage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <Box sx={{ maxWidth: 920, minWidth: 0 }}>
      <Box component="header" sx={{ minWidth: 0 }}>
        <Typography variant="h1" sx={{ overflowWrap: 'anywhere' }}>Hola, {user.displayName}</Typography>
        <Typography color="text.secondary" sx={{ mt: 1, overflowWrap: 'anywhere' }}>{roleLabels[user.role]} · {user.email}</Typography>
      </Box>

      <Box component="section" aria-labelledby="quick-actions-title" sx={{ mt: { xs: 4, sm: 5 } }}>
        <Typography id="quick-actions-title" variant="h2">Acciones rápidas</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap flexWrap="wrap" sx={{ mt: 2 }}>
          <Button component={Link} to="/providers/new" variant="contained">Nuevo proveedor</Button>
          <Button component={Link} to="/clients/new" variant="contained">Nuevo cliente</Button>
          <Button component={Link} to="/contacts?action=new-contact" variant="contained">Nuevo contacto</Button>
        </Stack>
      </Box>

      <Paper component="section" aria-labelledby="recent-activity-title" variant="outlined" sx={{ mt: { xs: 4, sm: 5 }, p: { xs: 2.5, sm: 4 } }}>
        <Typography id="recent-activity-title" variant="h2">Actividad reciente</Typography>
        <RecentActivity />
      </Paper>
    </Box>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnlyRoute><LoginPage /></PublicOnlyRoute>} />
      <Route path="/change-password" element={<ChangePasswordRoute><ChangePasswordPage /></ChangePasswordRoute>} />
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/providers" element={<ProvidersPage />} />
        <Route path="/providers/new" element={<NewProviderPage />} />
        <Route path="/providers/:id/edit" element={<EditProviderPage />} />
        <Route path="/providers/:id" element={<ProviderDetailPage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/clients/new" element={<NewClientPage />} />
        <Route path="/clients/:clientId/edit" element={<EditClientPage />} />
        <Route path="/clients/:clientId" element={<ClientDetailPage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/automations" element={<AutomationsPage />} />
        <Route path="/automations/remissions/audi" element={<AudiRemissionsPage />} />
        <Route element={<AdminRoute />}>
          <Route path="/users" element={<UsersPage />} />
          <Route path="/users/new" element={<NewUserPage />} />
          <Route path="/users/:userId/edit" element={<EditUserPage />} />
          <Route path="/users/:userId" element={<UserDetailPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
