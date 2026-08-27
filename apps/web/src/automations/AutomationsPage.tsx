import SettingsSuggestRoundedIcon from '@mui/icons-material/SettingsSuggestRounded';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { Link } from 'react-router-dom';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { PageHeader } from '../components/PageHeader';

export function AutomationsPage() {
  return (
    <>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Automatizaciones' }]} />
      <PageHeader title="Automatizaciones" description="Administra la configuración operativa de las automatizaciones disponibles." />
      <Paper variant="outlined" sx={{ mt: 4, p: { xs: 3, sm: 4 }, maxWidth: 760 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" spacing={3}>
          <Stack direction="row" spacing={2} alignItems="center">
            <Box sx={{ display: 'grid', placeItems: 'center', width: 44, height: 44, bgcolor: 'primary.main', borderRadius: 1 }}><SettingsSuggestRoundedIcon /></Box>
            <Box><Typography variant="h2">Remisiones</Typography><Typography color="text.secondary" sx={{ mt: 0.5 }}>Audi</Typography></Box>
          </Stack>
          <Button component={Link} to="/automations/remissions/audi" variant="contained">Administrar</Button>
        </Stack>
      </Paper>
    </>
  );
}
