import { Alert, Autocomplete, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { searchCompanies, type CompanySearchResult } from '../services/companies';
import { assignPaymentAlias, managePaymentAlias, type PaymentAliasRecord, type PaymentAliasResolution } from '../services/companyAliases';
import { assignPaymentFile, type PaymentNotificationFileError, type PointAssignment } from '../services/paymentNotifications';

const companyLabel = (item: CompanySearchResult) => `${item.commercialName} · ${item.rfc || item.companyType} · #${item.id}`;
type Mode = 'DETAIL' | 'ASSIGN' | 'REASSIGN' | 'DEACTIVATE' | 'POINT_ASSIGN' | 'POINT_CHANGE' | 'POINT_REVOKE';

export function AssignPaymentAliasDialog({ fileError, resolution, executionId, unavailable, initialMode = 'DETAIL', onClose, onSaved }: {
  fileError: PaymentNotificationFileError;
  resolution: PaymentAliasResolution | null;
  executionId?: string;
  unavailable: boolean;
  initialMode?: 'DETAIL' | 'ASSIGN';
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [snapshot, setSnapshot] = useState<PaymentAliasRecord | null>(null);
  const [pointSnapshot, setPointSnapshot] = useState<PointAssignment | null>(null);
  const [alias, setAlias] = useState(fileError.detail ?? '');
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<CompanySearchResult[]>([]);
  const [company, setCompany] = useState<CompanySearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const pointMode = mode.startsWith('POINT_');
  const point = fileError.fileAssignment;
  const pointActive = point?.assignment?.status === 'ACTIVA';
  const searchEnabled = ['ASSIGN', 'REASSIGN', 'POINT_ASSIGN', 'POINT_CHANGE'].includes(mode);

  useEffect(() => {
    let active = true;
    setOptions([]); setSearchError(false);
    if (!searchEnabled || search.trim().length < 2) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(() => {
      searchCompanies(search.trim()).then((results) => { if (active) setOptions(results); })
        .catch(() => { if (active) setSearchError(true); })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [search, searchEnabled]);

  function start(next: Mode) {
    setMode(next); setSnapshot(resolution?.assignment ?? null); setConfirmed(false);
    setPointSnapshot(point?.assignment ?? null);
    setCompany(null); setSearch(''); setError(null); setSaved(false); setNeedsConfirmation(false);
  }

  async function save() {
    if (saving || unavailable) return;
    setSaving(true); setError(null);
    try {
      if (pointMode && point?.canManage && point.fileId && executionId && confirmed) {
        const action = mode === 'POINT_ASSIGN' ? 'ASSIGN' : mode === 'POINT_CHANGE' ? 'CHANGE' : 'REVOKE';
        await assignPaymentFile(executionId, point.fileId, action, pointSnapshot?.version ?? 0, action === 'REVOKE' ? undefined : company?.id);
      } else if (mode === 'ASSIGN' && company) await assignPaymentAlias(company.id, alias, confirmed);
      else if (mode === 'REASSIGN' && snapshot && company && confirmed) await managePaymentAlias(snapshot, 'REASSIGN', company.id);
      else if (mode === 'DEACTIVATE' && snapshot && confirmed) await managePaymentAlias(snapshot, 'DEACTIVATE');
      else return;
      setMode('DETAIL'); setSaved(true); setConfirmed(false);
      try { await onSaved(); }
      catch { setError('Cambio guardado. Actualiza el estado para consultar la asignación vigente.'); }
    } catch (reason) {
      const api = reason as { code?: string; status?: number };
      if (api.code === 'PERMANENT_ALIAS_CONFIRMATION_REQUIRED') setNeedsConfirmation(true);
      else if (api.code === 'ALIAS_STATE_CHANGED' || api.code === 'POINT_ASSIGNMENT_CHANGED' || api.code === 'POINT_FILE_UNSAFE') {
        setMode('DETAIL');
        await onSaved().catch(() => undefined);
        setError(pointMode ? 'La identidad, asignación o seguridad del archivo cambió. Revisa el detalle actualizado antes de continuar.' : 'El alias fue modificado por otra operación. Revisa su estado actual antes de confirmar de nuevo.');
      } else setError(api.code === 'ALIAS_ALREADY_ASSOCIATED'
        ? 'El alias coincide con un alias o nombre comercial de otra empresa. Revisa la selección.'
        : api.status === 403 ? 'No tienes permisos para gestionar este alias.'
          : api.status === 401 ? 'Tu sesión expiró. Inicia sesión nuevamente.'
            : api.status === 404 ? 'El alias o la empresa ya no están disponibles. Actualiza el estado.'
              : api.status === 400 ? 'Revisa el alias y selecciona una empresa diferente para cambiar la asignación.'
                : 'No fue posible guardar el cambio. Inténtalo nuevamente.');
    } finally { setSaving(false); }
  }

  const active = resolution?.state === 'ACTIVE';
  const inactive = resolution?.state === 'INACTIVE';
  const confirmation = pointMode
    ? mode === 'POINT_REVOKE' ? 'Confirmo revocar solo la asignación de este archivo, sin modificar aliases permanentes.'
      : `Confirmo asignar solo este archivo de este correo a ${company?.commercialName ?? 'la empresa seleccionada'}, sin crear un alias permanente.`
    : mode === 'DEACTIVATE'
    ? `Confirmo desactivar el alias permanente «${snapshot?.alias}» de ${snapshot?.companyName}.`
    : mode === 'REASSIGN'
      ? `Confirmo cambiar el alias permanente «${snapshot?.alias}» de ${snapshot?.companyName} a ${company?.commercialName ?? 'la empresa seleccionada'}.`
      : `Confirmo que este alias debe identificar permanentemente a ${company?.commercialName ?? 'la empresa seleccionada'}.`;
  const canSave = pointMode ? !!point?.canManage && confirmed && (mode === 'POINT_REVOKE' ? !!pointSnapshot : !!company && (mode !== 'POINT_CHANGE' || company.id !== pointSnapshot?.companyId))
    : mode === 'DEACTIVATE' ? confirmed && !!snapshot
    : !!company && !!alias.trim() && (mode !== 'REASSIGN' || (confirmed && company.id !== snapshot?.companyId)) && (!needsConfirmation || confirmed);

  return <Dialog open onClose={() => { if (!saving) onClose(); }} fullWidth maxWidth="sm" aria-labelledby="payment-file-dialog-title">
    <DialogTitle id="payment-file-dialog-title">{mode === 'DETAIL' ? 'Detalle del archivo' : mode === 'POINT_ASSIGN' ? 'Asignar solo este archivo' : mode === 'POINT_CHANGE' ? 'Cambiar empresa de este archivo' : mode === 'POINT_REVOKE' ? 'Revocar asignación puntual' : mode === 'ASSIGN' ? 'Asignar alias permanente' : mode === 'REASSIGN' ? 'Cambiar empresa' : 'Desactivar alias'}</DialogTitle>
    <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
      <Typography fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{fileError.fileName}</Typography>
      <Typography variant="body2">Alias detectado: {fileError.detail ?? 'No disponible'}</Typography>
      <Typography variant="body2" color="text.secondary">Error histórico reportado por n8n: {fileError.errorCode}. No determina la asignación actual del catálogo.</Typography>
      {unavailable && <Alert severity="warning" action={<Button color="inherit" disabled={saving} onClick={() => void onSaved().catch(() => undefined)}>Actualizar</Button>}>Consulta el estado actual antes de gestionar el alias.</Alert>}
      {!unavailable && mode === 'DETAIL' && <>
        <Typography>Empresa asignada: {pointActive ? point.assignment!.companyName : resolution?.company?.name ?? 'Ninguna'}</Typography>
        {pointActive && <Typography>Asignado solo a este archivo</Typography>}
        {pointActive && !point?.enabled && <Alert severity="info">Su gestión está deshabilitada en este entorno.</Alert>}
        {active && !pointActive && <Typography color="info.main">Alias asignado · pendiente de reproceso</Typography>}
        {inactive && <Typography>Alias desactivado · empresa anterior: {resolution.assignment?.companyName}</Typography>}
        {resolution?.state === 'CONFLICT' && <Alert severity="warning">Hay coincidencias ambiguas en el catálogo. No se puede cambiar la asignación desde este archivo.</Alert>}
        {resolution?.state === 'NAME_ONLY' && <Alert severity="info">La empresa se reconoce por su nombre comercial, no por un alias independiente. Ese nombre no se cambia ni se desactiva desde aquí.</Alert>}
        {point?.enabled && <>
          {point.blockedReason && <Alert severity="warning">{point.blockedReason}</Alert>}
          {point.assignment?.status === 'REVOCADA' && <Typography>Asignación puntual revocada.</Typography>}
          {pointActive ? <Stack direction="row" spacing={1}>
            <Button variant="outlined" disabled={!point.canManage} onClick={() => start('POINT_CHANGE')}>Cambiar empresa de este archivo</Button>
            <Button color="error" sx={{ color: (theme) => theme.palette.mode === 'dark' ? theme.palette.error.light : theme.palette.error.dark }} disabled={!point.canManage} onClick={() => start('POINT_REVOKE')}>Revocar asignación puntual</Button>
          </Stack> : <Button variant="outlined" disabled={!point.canManage || !executionId} onClick={() => start('POINT_ASSIGN')}>Asignar solo este archivo</Button>}
        </>}
        {active && !pointActive && <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={() => start('REASSIGN')}>Cambiar empresa</Button>
          <Button color="error" sx={{ color: (theme) => theme.palette.mode === 'dark' ? theme.palette.error.light : theme.palette.error.dark }} onClick={() => start('DEACTIVATE')}>Desactivar alias</Button>
        </Stack>}
        {!pointActive && resolution && (inactive || resolution.state === 'UNASSIGNED') && <Button variant="outlined" onClick={() => start('ASSIGN')}>{point?.enabled ? 'Asignar alias permanente' : 'Asignar alias'}</Button>}
      </>}
      {pointMode || mode === 'DETAIL' ? point?.enabled && !unavailable && <Alert severity="info">{point.n8nReady ? 'La asignación puntual se guarda en la base de datos del Hub y se aplica al reprocesar el correo solo si todos los archivos asignados son seguros.' : 'La asignación puntual se guarda en la base de datos del Hub y todavía no puede usarse para reprocesar: la integración con n8n está pendiente.'}</Alert> : null}
      {mode === 'REASSIGN' && <Typography>Asignación actual: {snapshot?.alias} → {snapshot?.companyName}</Typography>}
      {mode === 'DEACTIVATE' && <Alert severity="warning">Se conservará el registro y su auditoría con estatus INACTIVO. n8n dejará de utilizar este alias activo; los nombres comerciales y otros aliases de la empresa conservan sus propias reglas.</Alert>}
      {mode === 'ASSIGN' && <TextField label="Alias permanente" value={alias} disabled={saving} inputProps={{ maxLength: 300 }} sx={{ '& .MuiInputLabel-root.Mui-focused': { color: 'text.primary' } }} onChange={(event) => {
        setAlias(event.target.value); setConfirmed(false); setNeedsConfirmation(false); setError(null);
      }} />}
      {searchEnabled && <Autocomplete options={options} value={company} inputValue={search} loading={loading} disabled={saving} filterOptions={(items) => items}
        isOptionEqualToValue={(a, b) => a.id === b.id} getOptionLabel={companyLabel}
        onInputChange={(_, value, reason) => { if (reason === 'input' || reason === 'clear') { setSearch(value); setCompany(null); setConfirmed(false); } }}
        onChange={(_, value) => { setCompany(value); setSearch(value ? companyLabel(value) : ''); setConfirmed(false); }}
        noOptionsText={search.trim().length < 2 ? 'Escribe al menos 2 caracteres' : 'No se encontraron empresas'} loadingText="Buscando empresas…"
        renderInput={(params) => <TextField {...params} label="Empresa existente" sx={{ '& .MuiInputLabel-root.Mui-focused': { color: 'text.primary' } }} />} />}
      {searchError && <Alert severity="error">No fue posible buscar empresas. Vuelve a escribir para reintentar.</Alert>}
      {mode !== 'DETAIL' && <Typography variant="body2" color="text.secondary">{pointMode ? 'Solo afecta a esta ocurrencia de archivo y correo. No modifica aliases permanentes ni errores históricos.' : 'Este cambio es permanente. No modifica procesamientos históricos ni ejecuta reprocesos.'}</Typography>}
      {needsConfirmation && <Alert severity="warning">Este alias parece un número de documento o identificador temporal.</Alert>}
      {(pointMode || mode === 'REASSIGN' || mode === 'DEACTIVATE' || needsConfirmation) && <FormControlLabel
        control={<Checkbox color="default" checked={confirmed} disabled={saving} onChange={(_, value) => setConfirmed(value)} />} label={confirmation} />}
      {saved && !error && <Alert severity="success">Cambio guardado.</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
    </Stack></DialogContent>
    <DialogActions>
      {mode === 'DETAIL' ? <Button color="inherit" disabled={saving} onClick={onClose}>Cerrar</Button> : <>
        <Button color="inherit" disabled={saving} onClick={() => start('DETAIL')}>Cancelar</Button>
        <Button variant="contained" color={mode === 'DEACTIVATE' || mode === 'POINT_REVOKE' ? 'error' : 'primary'}
          sx={mode === 'DEACTIVATE' || mode === 'POINT_REVOKE' ? { bgcolor: 'error.dark', color: 'common.white', '&:hover': { bgcolor: 'error.dark' } } : undefined}
          disabled={saving || unavailable || !canSave} onClick={() => void save()}>
          {saving ? 'Guardando…' : mode === 'POINT_REVOKE' ? 'Confirmar revocación' : pointMode ? 'Guardar asignación puntual' : mode === 'DEACTIVATE' ? 'Confirmar desactivación' : mode === 'REASSIGN' ? 'Confirmar cambio' : 'Guardar alias'}
        </Button>
      </>}
    </DialogActions>
  </Dialog>;
}
