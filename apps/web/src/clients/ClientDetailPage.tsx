import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Paper, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { PageHeader } from '../components/PageHeader';
import { CompanyStatusChip } from '../components/CompanyStatusChip';
import { CompanyAddressesSection } from '../companies/CompanyAddressesSection';
import { CompanyAliasesSection } from '../companies/CompanyAliasesSection';
import { CompanyContactsSection } from '../companies/CompanyContactsSection';
import { AbreviaturasDeCliente } from '../manufacturing/AbreviaturasDeCliente';
import { ClientApiError, deactivateClient, getClient, reactivateClient, type ClientDetail } from '../services/clients';

const roleLabels: Record<string, string> = {
  PROVEEDOR: 'Proveedor',
  SERVICIO: 'Proveedor de servicios',
  FLETE: 'Flete',
  CLIENTE: 'Cliente',
  OTRO: 'Otro'
};

function DetailField({ label, value }: { label: string; value: string }) {
  return <Box><Typography variant="overline" color="text.secondary">{label}</Typography><Typography>{value}</Typography></Box>;
}

export function ClientDetailPage() {
  const { clientId = '' } = useParams();
  const location = useLocation();
  const directoryPath = typeof location.state === 'object' && location.state !== null && 'directoryPath' in location.state && typeof location.state.directoryPath === 'string' ? location.state.directoryPath : '/clients';
  const successMessage = typeof location.state === 'object' && location.state !== null && 'successMessage' in location.state && typeof location.state.successMessage === 'string' ? location.state.successMessage : null;
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [error, setError] = useState<ClientApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getClient(clientId)
      .then((response) => { if (active) setClient(response); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof ClientApiError ? reason : new ClientApiError(0, undefined, null)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [clientId, retry]);

  if (loading) return <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress aria-label="Cargando cliente" /></Box>;

  if (error?.status === 404) {
    return <><PageHeader title="Cliente no encontrado" /><EmptyState title="No se encontró el cliente solicitado." description="Es posible que ya no esté disponible." /><Button component={Link} to={directoryPath} sx={{ mt: 3 }}>Volver a clientes</Button></>;
  }

  if (error || !client) {
    return <><PageHeader title="Cliente" /><Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>} sx={{ mt: 4, maxWidth: 760 }}>No fue posible cargar el cliente. Intenta nuevamente.</Alert><Button component={Link} to={directoryPath} sx={{ mt: 3 }}>Volver a clientes</Button></>;
  }

  // The company can hold other roles (e.g. PROVEEDOR) that stay active independently of the
  // CLIENTE role, so client.status (the company's status) is never the Client lifecycle signal.
  // clientStatus is returned explicitly by the backend for exactly this reason.
  const isActive = client.clientStatus === 'ACTIVO';
  const hasOtherRoles = client.roles.some((role) => role !== 'CLIENTE');
  async function changeStatus() {
    setChangingStatus(true); setActionError(null);
    try {
      const response = isActive ? await deactivateClient(clientId) : await reactivateClient(clientId);
      setClient(response.client); setConfirming(false);
    } catch { setActionError('No fue posible actualizar el estado del cliente. Intenta nuevamente.'); }
    finally { setChangingStatus(false); }
  }

  return (
    <>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Clientes', to: directoryPath }, { label: client.commercialName }]} />
      <PageHeader title={client.commercialName} description="Detalle del cliente.">
        <Button component={Link} to={`/clients/${clientId}/edit`} state={{ directoryPath }} variant="contained">Editar cliente</Button>
        <Button color={isActive ? 'warning' : 'success'} variant="outlined" onClick={() => { setActionError(null); setConfirming(true); }}>{isActive ? 'Desactivar cliente' : 'Reactivar cliente'}</Button>
        <Button component={Link} to={directoryPath}>Volver a clientes</Button>
      </PageHeader>
      <Stack spacing={2} sx={{ mt: 4, maxWidth: 840 }}>
        {successMessage && <Alert severity="success">{successMessage}</Alert>}
        {actionError && <Alert severity="error">{actionError}</Alert>}
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
          <Typography variant="h2" sx={{ fontSize: '1.125rem' }}>Información general</Typography>
          {/* BLOQUEADO is a company-level state independent of the CLIENTE role's own status
              (clientStatus) — it must win here so a blocked company is never shown as a
              normally active or inactive Client, matching how Providers surfaces it. */}
          <Box sx={{ mt: 2 }}><Typography variant="overline" color="text.secondary">Estado</Typography><Box><CompanyStatusChip status={client.status === 'BLOQUEADO' ? 'BLOQUEADO' : (isActive ? 'ACTIVO' : 'INACTIVO')} /></Box></Box>
          {hasOtherRoles && <Box sx={{ mt: 3 }}><Typography variant="overline" color="text.secondary">Roles</Typography><Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 0.5 }}>{client.roles.map((role) => <Chip key={role} label={roleLabels[role] ?? role} size="small" variant="outlined" />)}</Stack></Box>}
          <Box sx={{ mt: 3 }}><Typography variant="overline" color="text.secondary">Notas internas</Typography><Typography>{client.notes?.trim() || 'Sin notas registradas.'}</Typography></Box>
        </Paper>
        <CompanyAddressesSection companyId={client.id} />
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
          <Typography variant="h2" sx={{ fontSize: '1.125rem' }}>Datos fiscales</Typography>
          {client.fiscal ? <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 2, sm: 6 }} sx={{ mt: 2 }}><DetailField label="Razón social" value={client.fiscal.legalName} /><DetailField label="RFC" value={client.fiscal.rfc} /></Stack> : <Typography color="text.secondary" sx={{ mt: 1 }}>No hay datos fiscales registrados.</Typography>}
        </Paper>
        <CompanyAliasesSection companyId={client.id} />
        {isActive && <AbreviaturasDeCliente cliente={{ id: client.id, nombre: client.commercialName }} />}
        <CompanyContactsSection companyId={client.id} />
      </Stack>
      <Dialog open={confirming} onClose={() => !changingStatus && setConfirming(false)}>
        <DialogTitle>{isActive ? 'Desactivar cliente' : 'Reactivar cliente'}</DialogTitle>
        <DialogContent><DialogContentText>{isActive ? `El rol de Cliente quedará inactivo.${hasOtherRoles ? ' Los demás roles de esta empresa no se verán afectados.' : ''}` : 'El rol de Cliente volverá a estar activo.'}</DialogContentText></DialogContent>
        <DialogActions><Button disabled={changingStatus} onClick={() => setConfirming(false)}>Cancelar</Button><Button color={isActive ? 'warning' : 'success'} disabled={changingStatus} onClick={() => void changeStatus()}>{isActive ? 'Desactivar' : 'Reactivar'}</Button></DialogActions>
      </Dialog>
    </>
  );
}
