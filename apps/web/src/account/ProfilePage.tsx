import { Box, Paper, Stack, Typography } from '@mui/material';
import { useAuth } from '../auth/authContext.core';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { PageHeader } from '../components/PageHeader';
import { MANUFACTURING_UI_VISIBLE } from '../automations/automationRoutes';
import { MisFirmas } from '../firmas/MisFirmas';
import { roleLabels, userStatusLabels } from '../services/userLabels';

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return <Box><Typography variant="overline" color="text.secondary">{etiqueta}</Typography><Typography>{valor}</Typography></Box>;
}

/** Mi perfil: información básica de la cuenta autenticada y la gestión personal de firmas. */
export function ProfilePage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Mi perfil' }]} />
      <PageHeader title="Mi perfil" description="Tu cuenta y tus firmas." />
      <Stack spacing={3} sx={{ mt: 4, maxWidth: 920 }}>
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }} component="section" aria-label="Información de la cuenta">
          <Typography variant="h2" sx={{ fontSize: '1.125rem' }}>Información de la cuenta</Typography>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <Dato etiqueta="Nombre" valor={user.displayName} />
            <Dato etiqueta="Correo" valor={user.email} />
            <Dato etiqueta="Rol" valor={roleLabels[user.role]} />
            <Dato etiqueta="Estado" valor={userStatusLabels[user.status]} />
          </Stack>
        </Paper>
        {MANUFACTURING_UI_VISIBLE && <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}><MisFirmas /></Paper>}
      </Stack>
    </>
  );
}
