import { Alert, Box, Button, CircularProgress, FormControl, Paper, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { PageHeader } from '../components/PageHeader';
import { ClientApiError, getClient, type ClientDetail, updateClient } from '../services/clients';
import type { FiscalChangeMode } from '../services/providers';

export function EditClientPage() {
  const { clientId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const directoryPath = typeof location.state === 'object' && location.state !== null && 'directoryPath' in location.state && typeof location.state.directoryPath === 'string' ? location.state.directoryPath : '/clients';
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [error, setError] = useState<ClientApiError | null>(null);
  const [retry, setRetry] = useState(0);
  const [commercialName, setCommercialName] = useState('');
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
    getClient(clientId).then((value) => {
      if (!active) return;
      setClient(value); setCommercialName(value.commercialName); setNotes(value.notes ?? ''); setLegalName(value.fiscal?.legalName ?? ''); setRfc(value.fiscal?.rfc ?? '');
    }).catch((reason: unknown) => { if (active) setError(reason instanceof ClientApiError ? reason : new ClientApiError(0, undefined, null)); });
    return () => { active = false; };
  }, [clientId, retry]);

  if (error?.status === 404) return <><PageHeader title="Cliente no encontrado" /><EmptyState title="No se encontró el cliente solicitado." description="Es posible que ya no esté disponible." /><Button component={Link} to={directoryPath} sx={{ mt: 3 }}>Volver a clientes</Button></>;
  if (error) return <><PageHeader title="Editar cliente" /><Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>} sx={{ mt: 4 }}>No fue posible cargar el cliente. Intenta nuevamente.</Alert></>;
  if (!client) return <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress aria-label="Cargando cliente" /></Box>;

  const existingFiscal = client.fiscal;
  const rfcChanged = Boolean(client.fiscal && rfc.trim().toUpperCase() !== client.fiscal.rfc);
  const changed = commercialName.trim() !== client.commercialName || (notes.trim() || '') !== (client.notes ?? '') || legalName.trim() !== (client.fiscal?.legalName ?? '') || rfc.trim().toUpperCase() !== (client.fiscal?.rfc ?? '') || Boolean(mode) || Boolean(effectiveStartDate);

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
      await updateClient(clientId, { commercialName: commercialName.trim(), notes: notes.trim() || null, fiscal: { legalName: legal, rfc: normalizedRfc, ...(rfcChanged ? { changeMode: mode as FiscalChangeMode } : {}), ...(mode === 'NEW_IDENTITY' ? { effectiveStartDate } : {}) } });
      navigate(`/clients/${clientId}`, { state: { directoryPath, successMessage: 'Cliente actualizado correctamente.' } });
    } catch (reason) {
      const api = reason as ClientApiError;
      setFieldError(
        api.code === 'CLIENT_NAME_CONFLICT' ? 'Ya existe una empresa con ese nombre comercial.'
        : api.code === 'CLIENT_RFC_CONFLICT' ? 'Ya existe una empresa registrada con ese RFC.'
        : api.code === 'FISCAL_REMOVAL_NOT_ALLOWED' ? 'No es posible eliminar la información fiscal desde esta edición.'
        : api.code === 'FISCAL_CHANGE_MODE_REQUIRED' ? 'Indica si el cambio de RFC es una corrección o una nueva identidad fiscal.'
        : `No fue posible actualizar el cliente. Inténtalo nuevamente.${api.requestId ? ` Referencia: ${api.requestId}` : ''}`
      );
    } finally { setSaving(false); }
  }

  return <><BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Clientes', to: directoryPath }, { label: client.commercialName, to: `/clients/${clientId}`, state: { directoryPath } }, { label: 'Editar' }]} /><PageHeader title="Editar cliente" description="Actualiza la información del cliente."><Button component={Link} to={{ pathname: `/clients/${clientId}` }} state={{ directoryPath }}>Volver al detalle</Button></PageHeader><Box component="form" noValidate onSubmit={submit} sx={{ maxWidth: 840, mt: 4 }}><Stack spacing={2}>
    {fieldError && <Alert severity="error">{fieldError}</Alert>}
    <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}><Typography variant="h2" sx={{ fontSize: '1.125rem', mb: 2.5 }}>Información general</Typography><Stack spacing={2.5}><TextField label="Nombre comercial" required disabled={saving} value={commercialName} onChange={(event) => setCommercialName(event.target.value)} fullWidth autoFocus /><TextField label="Notas internas" disabled={saving} value={notes} onChange={(event) => setNotes(event.target.value)} multiline minRows={4} fullWidth /></Stack></Paper>
    <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}><Typography variant="h2" sx={{ fontSize: '1.125rem', mb: 2.5 }}>Datos fiscales</Typography><Stack spacing={2.5}><TextField label="Razón social" disabled={saving} value={legalName} onChange={(event) => setLegalName(event.target.value)} fullWidth /><TextField label="RFC" disabled={saving} value={rfc} onChange={(event) => setRfc(event.target.value.toUpperCase())} fullWidth />{rfcChanged && <FormControl disabled={saving}><Typography fontWeight={600}>El RFC actual cambió. ¿Qué representa este cambio?</Typography><Stack sx={{ mt: 1 }}><label><input type="radio" checked={mode === 'CORRECTION'} onChange={() => setMode('CORRECTION')} /> Corregir un dato capturado incorrectamente</label><Typography variant="body2" color="text.secondary">Reemplaza el RFC actual porque estaba registrado de forma incorrecta.</Typography><label><input type="radio" checked={mode === 'NEW_IDENTITY'} onChange={() => setMode('NEW_IDENTITY')} /> Registrar una nueva identidad fiscal</label><Typography variant="body2" color="text.secondary">Conserva la identidad anterior en el historial y registra la nueva como vigente.</Typography></Stack></FormControl>}{rfcChanged && mode === 'NEW_IDENTITY' && <TextField label="Vigente desde" type="date" value={effectiveStartDate} onChange={(event) => setEffectiveStartDate(event.target.value)} disabled={saving} InputLabelProps={{ shrink: true }} required />}</Stack></Paper>
    <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1.5} justifyContent="flex-end"><Button type="button" disabled={saving} onClick={() => navigate(`/clients/${clientId}`, { state: { directoryPath } })}>Cancelar</Button><Button type="submit" variant="contained" disabled={saving || !changed} startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}>{saving ? 'Guardando...' : 'Guardar cambios'}</Button></Stack>
  </Stack></Box></>;
}
