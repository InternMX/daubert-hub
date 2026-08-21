import { Alert, Box, Button, CircularProgress, FormControl, FormHelperText, InputLabel, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { PageHeader } from '../components/PageHeader';
import { getProvider, ProviderApiError, type FiscalChangeMode, type ProviderDetail, type ProviderType, updateProvider } from '../services/providers';

const types: Array<{ value: ProviderType; label: string }> = [{ value: 'PROVEEDOR', label: 'Proveedor' }, { value: 'SERVICIO', label: 'Proveedor de servicios' }, { value: 'FLETE', label: 'Flete' }];

export function EditProviderPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const directoryPath = typeof location.state === 'object' && location.state !== null && 'directoryPath' in location.state && typeof location.state.directoryPath === 'string' ? location.state.directoryPath : '/providers';
  const [provider, setProvider] = useState<ProviderDetail | null>(null);
  const [error, setError] = useState<ProviderApiError | null>(null);
  const [retry, setRetry] = useState(0);
  const [commercialName, setCommercialName] = useState('');
  const [providerType, setProviderType] = useState<ProviderType>('PROVEEDOR');
  const [notes, setNotes] = useState('');
  const [legalName, setLegalName] = useState('');
  const [rfc, setRfc] = useState('');
  const [mode, setMode] = useState<FiscalChangeMode | ''>('');
  const [effectiveStartDate, setEffectiveStartDate] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setError(null);
    getProvider(id).then((value) => {
      if (!active) return;
      setProvider(value); setCommercialName(value.commercialName); setProviderType(value.providerType); setNotes(value.notes ?? ''); setLegalName(value.fiscal?.legalName ?? ''); setRfc(value.fiscal?.rfc ?? '');
    }).catch((reason: unknown) => { if (active) setError(reason instanceof ProviderApiError ? reason : new ProviderApiError(0, undefined, null)); });
    return () => { active = false; };
  }, [id, retry]);

  if (error?.status === 404) return <><PageHeader title="Proveedor no encontrado" /><EmptyState title="No se encontró el proveedor solicitado." description="Es posible que ya no esté disponible." /><Button component={Link} to={directoryPath} sx={{ mt: 3 }}>Volver a proveedores</Button></>;
  if (error) return <><PageHeader title="Editar proveedor" /><Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>} sx={{ mt: 4 }}>No fue posible cargar el proveedor. Intenta nuevamente.</Alert></>;
  if (!provider) return <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress aria-label="Cargando proveedor" /></Box>;

  const multiRole = provider.roles.filter((role) => ['PROVEEDOR', 'SERVICIO', 'FLETE'].includes(role)).length > 1;
  const existingFiscal = provider.fiscal;
  const rfcChanged = Boolean(provider.fiscal && rfc.trim().toUpperCase() !== provider.fiscal.rfc);
  const changed = commercialName.trim() !== provider.commercialName || providerType !== provider.providerType || (notes.trim() || '') !== (provider.notes ?? '') || legalName.trim() !== (provider.fiscal?.legalName ?? '') || rfc.trim().toUpperCase() !== (provider.fiscal?.rfc ?? '') || Boolean(mode) || Boolean(effectiveStartDate);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const legal = legalName.trim(); const normalizedRfc = rfc.trim().toUpperCase();
    if (!commercialName.trim()) return setFieldError('Ingresa el nombre comercial.');
    if (Boolean(legal) !== Boolean(normalizedRfc)) return setFieldError('Para registrar datos fiscales, completa la razón social y el RFC.');
    if (normalizedRfc && !/^\S{12,13}$/.test(normalizedRfc)) return setFieldError('Ingresa un RFC de 12 o 13 caracteres sin espacios.');
    if (existingFiscal && !legal && !normalizedRfc) return setFieldError('La información fiscal existente no puede eliminarse desde esta edición.');
    if (rfcChanged && !mode) return setFieldError('Indica qué representa el cambio de RFC.');
    if (mode === 'NEW_IDENTITY' && !effectiveStartDate) return setFieldError('Indica desde cuándo está vigente la nueva identidad fiscal.');
    setFieldError(null); setSaving(true);
    try {
      await updateProvider(id, { commercialName: commercialName.trim(), providerType, notes: notes.trim() || null, fiscal: { legalName: legal, rfc: normalizedRfc, ...(rfcChanged ? { changeMode: mode as FiscalChangeMode } : {}), ...(mode === 'NEW_IDENTITY' ? { effectiveStartDate } : {}) } });
      navigate(`/providers/${id}`, { state: { directoryPath, successMessage: 'Proveedor actualizado correctamente.' } });
    } catch (reason) {
      const api = reason as ProviderApiError;
      setFieldError(api.code === 'PROVIDER_NAME_ALREADY_EXISTS' ? 'Ya existe un proveedor o empresa con ese nombre comercial.' : api.code === 'RFC_ALREADY_EXISTS' ? 'Ya existe una empresa registrada con ese RFC.' : `No fue posible actualizar el proveedor. Inténtalo nuevamente.${api.requestId ? ` Referencia: ${api.requestId}` : ''}`);
    } finally { setSaving(false); }
  }

  return <><BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Proveedores', to: directoryPath }, { label: provider.commercialName, to: `/providers/${id}`, state: { directoryPath } }, { label: 'Editar' }]} /><PageHeader title="Editar proveedor" description="Actualiza la información del proveedor."><Button component={Link} to={{ pathname: `/providers/${id}` }} state={{ directoryPath }}>Volver al detalle</Button></PageHeader><Box component="form" noValidate onSubmit={submit} sx={{ maxWidth: 840, mt: 4 }}><Stack spacing={2}>
    {fieldError && <Alert severity="error">{fieldError}</Alert>}
    <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}><Typography variant="h2" sx={{ fontSize: '1.125rem', mb: 2.5 }}>Información general</Typography><Stack spacing={2.5}><TextField label="Nombre comercial" required disabled={saving} value={commercialName} onChange={(event) => setCommercialName(event.target.value)} fullWidth autoFocus /><FormControl fullWidth disabled={saving || multiRole}><InputLabel id="edit-provider-type-label">Tipo de proveedor</InputLabel><Select labelId="edit-provider-type-label" label="Tipo de proveedor" value={providerType} onChange={(event) => setProviderType(event.target.value as ProviderType)}>{types.map((type) => <MenuItem key={type.value} value={type.value}>{type.label}</MenuItem>)}</Select>{multiRole && <FormHelperText>Este proveedor tiene varios roles activos. El tipo se administra en el flujo de roles.</FormHelperText>}</FormControl><TextField label="Notas internas" disabled={saving} value={notes} onChange={(event) => setNotes(event.target.value)} multiline minRows={4} fullWidth /></Stack></Paper>
    <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}><Typography variant="h2" sx={{ fontSize: '1.125rem', mb: 2.5 }}>Datos fiscales</Typography><Stack spacing={2.5}><TextField label="Razón social" disabled={saving} value={legalName} onChange={(event) => setLegalName(event.target.value)} fullWidth /><TextField label="RFC" disabled={saving} value={rfc} onChange={(event) => setRfc(event.target.value.toUpperCase())} fullWidth />{rfcChanged && <FormControl disabled={saving}><Typography fontWeight={600}>El RFC actual cambió. ¿Qué representa este cambio?</Typography><Stack sx={{ mt: 1 }}><label><input type="radio" checked={mode === 'CORRECTION'} onChange={() => setMode('CORRECTION')} /> Corregir un dato capturado incorrectamente</label><Typography variant="body2" color="text.secondary">Reemplaza el RFC actual porque estaba registrado de forma incorrecta.</Typography><label><input type="radio" checked={mode === 'NEW_IDENTITY'} onChange={() => setMode('NEW_IDENTITY')} /> Registrar una nueva identidad fiscal</label><Typography variant="body2" color="text.secondary">Conserva la identidad anterior en el historial y registra la nueva como vigente.</Typography></Stack></FormControl>}{rfcChanged && mode === 'NEW_IDENTITY' && <TextField label="Vigente desde" type="date" value={effectiveStartDate} onChange={(event) => setEffectiveStartDate(event.target.value)} disabled={saving} InputLabelProps={{ shrink: true }} required />}</Stack></Paper>
    <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1.5} justifyContent="flex-end"><Button type="button" disabled={saving} onClick={() => navigate(`/providers/${id}`, { state: { directoryPath } })}>Cancelar</Button><Button type="submit" variant="contained" disabled={saving || !changed} startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}>{saving ? 'Guardando...' : 'Guardar cambios'}</Button></Stack>
  </Stack></Box></>;
}
