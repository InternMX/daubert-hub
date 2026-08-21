import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { createProvider, type CreatedProvider } from '../services/providers';
import { ProviderForm } from './ProviderForm';

function providerTypeLabel(providerType: CreatedProvider['providerType']): string {
  return { PROVEEDOR: 'Proveedor', SERVICIO: 'Proveedor de servicios', FLETE: 'Flete' }[providerType];
}

function SuccessState({ provider, onReset, onBack }: { provider: CreatedProvider; onReset: () => void; onBack: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <Box sx={{ maxWidth: 840, mt: 4 }}>
      <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 }, borderTop: '4px solid', borderTopColor: 'primary.main' }}>
        <Typography ref={heading} tabIndex={-1} variant="h2">Proveedor registrado</Typography>
        <Typography sx={{ mt: 1 }} color="text.secondary">{provider.commercialName} se registró correctamente.</Typography>
        <Stack spacing={2} sx={{ mt: 4 }}>
          <Box><Typography variant="overline" color="text.secondary">Tipo</Typography><Typography>{providerTypeLabel(provider.providerType)}</Typography></Box>
          <Box><Typography variant="overline" color="text.secondary">Datos fiscales</Typography><Typography>{provider.fiscal ? provider.fiscal.rfc : 'Pendientes'}</Typography></Box>
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 4 }}>
          <Button variant="contained" onClick={onReset}>Registrar otro proveedor</Button>
          <Button variant="outlined" onClick={onBack}>Volver a proveedores</Button>
        </Stack>
      </Paper>
    </Box>
  );
}

export function NewProviderPage() {
  const navigate = useNavigate();
  const [provider, setProvider] = useState<CreatedProvider | null>(null);
  return (
    <>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Proveedores', to: '/providers' }, { label: 'Nuevo proveedor' }]} />
      <PageHeader title="Nuevo proveedor" description="Registra un proveedor, proveedor de servicios o flete.">
        <Button variant="text" onClick={() => navigate('/providers')}>Volver a proveedores</Button>
      </PageHeader>
      {provider ? <SuccessState provider={provider} onReset={() => setProvider(null)} onBack={() => navigate('/providers')} /> : <ProviderForm onSubmit={async (input) => setProvider((await createProvider(input)).provider)} onCancel={() => navigate('/providers')} />}
    </>
  );
}
