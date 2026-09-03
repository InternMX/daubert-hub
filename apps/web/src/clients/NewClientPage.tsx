import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { createClient, type CreatedClient } from '../services/clients';
import { ClientForm } from './ClientForm';

function SuccessState({ client, onReset, onBack }: { client: CreatedClient; onReset: () => void; onBack: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <Box sx={{ maxWidth: 840, mt: 4 }}>
      <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 }, borderTop: '4px solid', borderTopColor: 'primary.main' }}>
        <Typography ref={heading} tabIndex={-1} variant="h2">Cliente registrado</Typography>
        <Typography sx={{ mt: 1 }} color="text.secondary">{client.commercialName} se registró correctamente.</Typography>
        <Stack spacing={2} sx={{ mt: 4 }}>
          <Box><Typography variant="overline" color="text.secondary">Datos fiscales</Typography><Typography>{client.fiscal ? client.fiscal.rfc : 'Pendientes'}</Typography></Box>
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 4 }}>
          <Button variant="contained" onClick={onReset}>Registrar otro cliente</Button>
          <Button variant="outlined" onClick={onBack}>Volver a clientes</Button>
        </Stack>
      </Paper>
    </Box>
  );
}

export function NewClientPage() {
  const navigate = useNavigate();
  const [client, setClient] = useState<CreatedClient | null>(null);
  return (
    <>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Clientes', to: '/clients' }, { label: 'Nuevo cliente' }]} />
      <PageHeader title="Nuevo cliente" description="Registra un nuevo cliente.">
        <Button variant="text" onClick={() => navigate('/clients')}>Volver a clientes</Button>
      </PageHeader>
      {client ? <SuccessState client={client} onReset={() => setClient(null)} onBack={() => navigate('/clients')} /> : <ClientForm onSubmit={async (input) => setClient((await createClient(input)).client)} onCancel={() => navigate('/clients')} />}
    </>
  );
}
