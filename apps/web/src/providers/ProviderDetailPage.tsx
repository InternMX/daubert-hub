import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Paper, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { PageHeader } from '../components/PageHeader';
import { deactivateProvider, getProvider, ProviderApiError, reactivateProvider, type ProviderDetail, type ProviderType } from '../services/providers';

const providerTypeLabels: Record<ProviderType, string> = {
  PROVEEDOR: 'Proveedor',
  SERVICIO: 'Proveedor de servicios',
  FLETE: 'Flete'
};

const roleLabels: Record<string, string> = {
  PROVEEDOR: 'Proveedor',
  SERVICIO: 'Proveedor de servicios',
  FLETE: 'Flete',
  CLIENTE: 'Cliente',
  OTRO: 'Otro'
};

const statusLabels: Record<string, string> = { ACTIVO: 'Activo', INACTIVO: 'Inactivo' };

function DetailField({ label, value }: { label: string; value: string }) {
  return <Box><Typography variant="overline" color="text.secondary">{label}</Typography><Typography>{value}</Typography></Box>;
}

export function ProviderDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const directoryPath = typeof location.state === 'object' && location.state !== null && 'directoryPath' in location.state && typeof location.state.directoryPath === 'string' ? location.state.directoryPath : '/providers';
  const successMessage = typeof location.state === 'object' && location.state !== null && 'successMessage' in location.state && typeof location.state.successMessage === 'string' ? location.state.successMessage : null;
  const [provider, setProvider] = useState<ProviderDetail | null>(null);
  const [error, setError] = useState<ProviderApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getProvider(id)
      .then((response) => { if (active) setProvider(response); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof ProviderApiError ? reason : new ProviderApiError(0, undefined, null)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, retry]);

  if (loading) return <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress aria-label="Cargando proveedor" /></Box>;

  if (error?.status === 404) {
    return <><PageHeader title="Proveedor no encontrado" /><EmptyState title="No se encontró el proveedor solicitado." description="Es posible que ya no esté disponible." /><Button component={Link} to={directoryPath} sx={{ mt: 3 }}>Volver a proveedores</Button></>;
  }

  if (error || !provider) {
    return <><PageHeader title="Proveedor" /><Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>} sx={{ mt: 4, maxWidth: 760 }}>No fue posible cargar el proveedor. Intenta nuevamente.</Alert><Button component={Link} to={directoryPath} sx={{ mt: 3 }}>Volver a proveedores</Button></>;
  }

  const isActive = provider.status === 'ACTIVO';
  async function changeStatus() {
    setChangingStatus(true); setActionError(null);
    try {
      const response = isActive ? await deactivateProvider(id) : await reactivateProvider(id);
      setProvider(response.provider); setConfirming(false);
    } catch { setActionError('No fue posible actualizar el estado del proveedor. Intenta nuevamente.'); }
    finally { setChangingStatus(false); }
  }

  return (
    <>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Proveedores', to: directoryPath }, { label: provider.commercialName }]} />
      <PageHeader title={provider.commercialName} description="Detalle del proveedor.">
        <Button component={Link} to={`/providers/${id}/edit`} state={{ directoryPath }} variant="contained">Editar proveedor</Button>
        <Button color={isActive ? 'warning' : 'success'} variant="outlined" onClick={() => { setActionError(null); setConfirming(true); }}>{isActive ? 'Desactivar proveedor' : 'Reactivar proveedor'}</Button>
        <Button component={Link} to={directoryPath}>Volver a proveedores</Button>
      </PageHeader>
      <Stack spacing={2} sx={{ mt: 4, maxWidth: 840 }}>
        {successMessage && <Alert severity="success">{successMessage}</Alert>}
        {actionError && <Alert severity="error">{actionError}</Alert>}
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
          <Typography variant="h2" sx={{ fontSize: '1.125rem' }}>Información general</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2}>
            <DetailField label="Tipo" value={providerTypeLabels[provider.providerType]} />
            <Box><Typography variant="overline" color="text.secondary">Estado</Typography><Box><Chip label={statusLabels[provider.status] ?? provider.status} color={provider.status === 'ACTIVO' ? 'success' : 'default'} size="small" /></Box></Box>
          </Stack>
          {!(provider.roles.length === 1 && provider.roles[0] === provider.providerType) && <Box sx={{ mt: 3 }}><Typography variant="overline" color="text.secondary">Roles</Typography><Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 0.5 }}>{provider.roles.map((role) => <Chip key={role} label={roleLabels[role] ?? role} size="small" variant="outlined" />)}</Stack></Box>}
          <Box sx={{ mt: 3 }}><Typography variant="overline" color="text.secondary">Notas internas</Typography><Typography>{provider.notes?.trim() || 'Sin notas registradas.'}</Typography></Box>
        </Paper>
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
          <Typography variant="h2" sx={{ fontSize: '1.125rem' }}>Datos fiscales</Typography>
          {provider.fiscal ? <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 2, sm: 6 }} sx={{ mt: 2 }}><DetailField label="Razón social" value={provider.fiscal.legalName} /><DetailField label="RFC" value={provider.fiscal.rfc} /></Stack> : <Typography color="text.secondary" sx={{ mt: 1 }}>No hay datos fiscales registrados.</Typography>}
        </Paper>
      </Stack>
      <Dialog open={confirming} onClose={() => !changingStatus && setConfirming(false)}>
        <DialogTitle>{isActive ? 'Desactivar proveedor' : 'Reactivar proveedor'}</DialogTitle>
        <DialogContent><DialogContentText>{isActive ? 'El proveedor quedará inactivo y se excluirá de procesos que excluyen empresas inactivas.' : 'El proveedor volverá a estar activo en el directorio y en procesos que excluyen empresas inactivas.'}</DialogContentText></DialogContent>
        <DialogActions><Button disabled={changingStatus} onClick={() => setConfirming(false)}>Cancelar</Button><Button color={isActive ? 'warning' : 'success'} disabled={changingStatus} onClick={changeStatus}>{isActive ? 'Desactivar' : 'Reactivar'}</Button></DialogActions>
      </Dialog>
    </>
  );
}
