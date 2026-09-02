import { Add, EditOutlined } from '@mui/icons-material';
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Paper, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { deactivateCompanyAddress, listCompanyAddresses, reactivateCompanyAddress, type CompanyAddress } from '../services/companyAddresses';
import { CompanyAddressFormDialog } from './CompanyAddressFormDialog';
import { companyAddressTypeLabels as typeLabels, formatCompanyAddress, presentAddressValue as present } from './companyAddressDisplay';

function AddressRow({ address, pending, onEdit, onStatus }: { address: CompanyAddress; pending: boolean; onEdit: () => void; onStatus: () => void }) {
  const active = address.estatus === 'ACTIVA';
  return <Box sx={{ py: 2.25, minWidth: 0, opacity: active ? 1 : 0.72 }}>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'flex-start' }} spacing={1.5}>
      <Box sx={{ minWidth: 0, flex: 1 }}><Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" alignItems="center"><Typography fontWeight={700}>{typeLabels[address.tipoDireccion]}</Typography>{address.esPrincipal && <Chip size="small" color="primary" label="Principal" />}<Chip size="small" color={active ? 'success' : 'default'} variant={active ? 'filled' : 'outlined'} label={active ? 'Activa' : 'Inactiva'} /></Stack>
        <Typography sx={{ mt: 0.75, overflowWrap: 'anywhere' }}>{formatCompanyAddress(address)}</Typography>{present(address.referencias) && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>Referencias: {address.referencias}</Typography>}{(address.fechaInicio || address.fechaFin) && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Vigencia: {address.fechaInicio || 'Sin fecha de inicio'} a {address.fechaFin || 'sin fecha de fin'}</Typography>}
      </Box>
      <Stack direction="row" spacing={0.5} flexShrink={0}>{active && <Button size="small" startIcon={<EditOutlined />} onClick={onEdit} disabled={pending}>Editar</Button>}<Button size="small" color={active ? 'warning' : 'success'} onClick={onStatus} disabled={pending}>{pending ? <CircularProgress size={16} color="inherit" /> : active ? 'Desactivar' : 'Reactivar'}</Button></Stack>
    </Stack>
  </Box>;
}

export function CompanyAddressesSection({ companyId }: { companyId: string }) {
  const [addresses, setAddresses] = useState<CompanyAddress[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(false); const [retry, setRetry] = useState(0); const [showInactive, setShowInactive] = useState(false); const [dialogOpen, setDialogOpen] = useState(false); const [editing, setEditing] = useState<CompanyAddress | null>(null); const [deactivating, setDeactivating] = useState<CompanyAddress | null>(null); const [pendingId, setPendingId] = useState<string | null>(null); const [actionError, setActionError] = useState<string | null>(null); const requestRef = useRef(0);
  useEffect(() => { const request = ++requestRef.current; setLoading(true); setError(false); listCompanyAddresses(companyId).then((result) => { if (request === requestRef.current) setAddresses(result); }).catch(() => { if (request === requestRef.current) setError(true); }).finally(() => { if (request === requestRef.current) setLoading(false); }); return () => { requestRef.current += 1; }; }, [companyId, retry]);
  const active = addresses.filter((address) => address.estatus === 'ACTIVA'); const inactive = addresses.filter((address) => address.estatus === 'INACTIVA');
  function replaceAddress(current: CompanyAddress[], address: CompanyAddress) {
    const reconciled = address.estatus === 'ACTIVA' && address.esPrincipal
      ? current.map((item) => item.id !== address.id && item.estatus === 'ACTIVA' && item.tipoDireccion === address.tipoDireccion ? { ...item, esPrincipal: false } : item)
      : current;
    return reconciled.some((item) => item.id === address.id) ? reconciled.map((item) => item.id === address.id ? address : item) : [...reconciled, address];
  }
  function saved(address: CompanyAddress) { setAddresses((current) => replaceAddress(current, address)); setDialogOpen(false); setEditing(null); setActionError(null); }
  function openEdit(address: CompanyAddress) { setEditing(address); setDialogOpen(true); }
  async function changeStatus(address: CompanyAddress, action: 'deactivate' | 'reactivate') { if (pendingId) return; setPendingId(address.id); setActionError(null); try { const updated = action === 'deactivate' ? await deactivateCompanyAddress(address.id) : await reactivateCompanyAddress(address.id); setAddresses((current) => replaceAddress(current, updated)); setDeactivating(null); } catch { setActionError(action === 'deactivate' ? 'No fue posible desactivar la dirección.' : 'No fue posible reactivar la dirección.'); } finally { setPendingId(null); } }
  return <Paper component="section" aria-labelledby="company-addresses-heading" variant="outlined" sx={{ p: { xs: 3, sm: 4 }, minWidth: 0 }}>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1.5}><Typography id="company-addresses-heading" variant="h2" sx={{ fontSize: '1.125rem' }}>Direcciones</Typography><Button variant="outlined" startIcon={<Add />} onClick={() => { setEditing(null); setDialogOpen(true); }}>Agregar dirección</Button></Stack>
    {actionError && <Alert severity="error" sx={{ mt: 2 }}>{actionError}</Alert>}
    {loading && <Box role="status" sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={24} aria-label="Cargando direcciones" /></Box>}
    {!loading && error && <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>} sx={{ mt: 2 }}>No fue posible cargar las direcciones.</Alert>}
    {!loading && !error && active.length === 0 && <Typography color="text.secondary" sx={{ mt: 2 }}>{inactive.length ? 'No hay direcciones activas.' : 'No hay direcciones registradas para esta empresa.'}</Typography>}
    {!loading && !error && active.length > 0 && <Stack divider={<Divider flexItem />} sx={{ mt: 1 }}>{active.map((address) => <AddressRow key={address.id} address={address} pending={pendingId === address.id} onEdit={() => openEdit(address)} onStatus={() => setDeactivating(address)} />)}</Stack>}
    {!loading && !error && inactive.length > 0 && <Box sx={{ mt: active.length ? 1 : 2 }}><Button size="small" onClick={() => setShowInactive((value) => !value)} aria-expanded={showInactive}>{showInactive ? 'Ocultar direcciones inactivas' : `Mostrar direcciones inactivas (${inactive.length})`}</Button>{showInactive && <Stack divider={<Divider flexItem />}>{inactive.map((address) => <AddressRow key={address.id} address={address} pending={pendingId === address.id} onEdit={() => openEdit(address)} onStatus={() => void changeStatus(address, 'reactivate')} />)}</Stack>}</Box>}
    <CompanyAddressFormDialog companyId={companyId} address={editing} open={dialogOpen} onClose={() => { setDialogOpen(false); setEditing(null); }} onSaved={saved} />
    <Dialog open={Boolean(deactivating)} onClose={() => !pendingId && setDeactivating(null)} maxWidth="xs" fullWidth><DialogTitle>Desactivar dirección</DialogTitle><DialogContent><Typography>La dirección dejará de mostrarse entre las direcciones activas. Podrás reactivarla posteriormente.</Typography></DialogContent><DialogActions><Button onClick={() => setDeactivating(null)} disabled={Boolean(pendingId)}>Cancelar</Button><Button variant="contained" color="warning" onClick={() => deactivating && void changeStatus(deactivating, 'deactivate')} disabled={Boolean(pendingId)}>Desactivar</Button></DialogActions></Dialog>
  </Paper>;
}
