import MarkEmailReadRoundedIcon from '@mui/icons-material/MarkEmailReadRounded';
import SettingsSuggestRoundedIcon from '@mui/icons-material/SettingsSuggestRounded';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { PageHeader } from '../components/PageHeader';

function AutomationCard({ icon, title, subtitle, to, actionLabel }: { icon: ReactNode; title: string; subtitle: string; to: string; actionLabel: string }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 }, maxWidth: 760 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" spacing={3}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Box sx={{ display: 'grid', placeItems: 'center', width: 44, height: 44, bgcolor: 'primary.main', borderRadius: 1 }}>{icon}</Box>
          <Box><Typography variant="h2">{title}</Typography><Typography color="text.secondary" sx={{ mt: 0.5 }}>{subtitle}</Typography></Box>
        </Stack>
        <Button component={Link} to={to} variant="contained">{actionLabel}</Button>
      </Stack>
    </Paper>
  );
}

export function AutomationsPage() {
  return (
    <>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Automatizaciones' }]} />
      <PageHeader title="Automatizaciones" description="Administra la configuración operativa de las automatizaciones disponibles." />
      <Stack spacing={3} sx={{ mt: 4 }}>
        <AutomationCard icon={<SettingsSuggestRoundedIcon />} title="Remisiones" subtitle="Audi" to="/automations/remissions/audi" actionLabel="Administrar" />
        <AutomationCard icon={<MarkEmailReadRoundedIcon />} title="Notificaciones de pago" subtitle="Seguimiento del procesamiento automático" to="/automations/payment-notifications" actionLabel="Ver panel" />
      </Stack>
    </>
  );
}
