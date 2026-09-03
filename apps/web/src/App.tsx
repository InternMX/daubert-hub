import { Button, Paper, Stack, Typography } from '@mui/material';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { PageHeader } from './components/PageHeader';
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

function HomePage() {
  return (
    <>
      <PageHeader title="Inicio" description="Centro de trabajo para la gestión operativa de Daubert Cromwell." />
      <Paper variant="outlined" sx={{ mt: 4, p: { xs: 3, sm: 4 }, maxWidth: 920 }}>
        <Typography variant="h2">Acciones rápidas</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 2.5 }}>
          <Button component={Link} to="/providers/new" variant="contained">Nuevo proveedor</Button>
          <Button component={Link} to="/contacts?action=new-contact" variant="contained">Nuevo contacto</Button>
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ mt: 2, p: { xs: 3, sm: 4 }, maxWidth: 920 }}>
        <Typography variant="h2">Actividad reciente</Typography>
        <RecentActivity />
      </Paper>
    </>
  );
}

export function App() {
  return (
    <AppShell>
      <Routes>
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
