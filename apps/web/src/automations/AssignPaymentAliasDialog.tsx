import { Alert, Autocomplete, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { searchCompanies, type CompanySearchResult } from '../services/companies';
import { assignPaymentAlias, managePaymentAlias, type PaymentAliasRecord, type PaymentAliasResolution } from '../services/companyAliases';
import type { PaymentNotificationFileError } from '../services/paymentNotifications';

const companyLabel = (item: CompanySearchResult) => `${item.commercialName} · ${item.rfc || item.companyType} · #${item.id}`;
type Mode = 'DETAIL' | 'ASSIGN' | 'REASSIGN' | 'DEACTIVATE';

export function AssignPaymentAliasDialog({ fileError, resolution, unavailable, initialMode = 'DETAIL', onClose, onSaved }: {
  fileError: PaymentNotificationFileError;
  resolution: PaymentAliasResolution | null;
  unavailable: boolean;
  initialMode?: 'DETAIL' | 'ASSIGN';
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [snapshot, setSnapshot] = useState<PaymentAliasRecord | null>(null);
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
  const searchEnabled = mode === 'ASSIGN' || mode === 'REASSIGN';

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
    setCompany(null); setSearch(''); setError(null); setSaved(false); setNeedsConfirmation(false);
  }

  async function save() {
    if (saving || unavailable) return;
    setSaving(true); setError(null);
    try {
      if (mode === 'ASSIGN' && company) await assignPaymentAlias(company.id, alias, confirmed);
      else if (mode === 'REASSIGN' && snapshot && company && confirmed) await managePaymentAlias(snapshot, 'REASSIGN', company.id);
      else if (mode === 'DEACTIVATE' && snapshot && confirmed) await managePaymentAlias(snapshot, 'DEACTIVATE');
      else return;
      setMode('DETAIL'); setSaved(true); setConfirmed(false);
      try { await onSaved(); }
      catch { setError('Cambio guardado. Actualiza el estado para consultar la asignación vigente.'); }
    } catch (reason) {
      const api = reason as { code?: string; status?: number };
      if (api.code === 'PERMANENT_ALIAS_CONFIRMATION_REQUIRED') setNeedsConfirmation(true);
      else if (api.code === 'ALIAS_STATE_CHANGED') {
        setMode('DETAIL');
        await onSaved().catch(() => undefined);
        setError('El alias fue modificado por otra operación. Revisa su estado actual antes de confirmar de nuevo.');
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
  const confirmation = mode === 'DEACTIVATE'
    ? `Confirmo desactivar el alias permanente «${snapshot?.alias}» de ${snapshot?.companyName}.`
    : mode === 'REASSIGN'
      ? `Confirmo cambiar el alias permanente «${snapshot?.alias}» de ${snapshot?.companyName} a ${company?.commercialName ?? 'la empresa seleccionada'}.`
      : `Confirmo que este alias debe identificar permanentemente a ${company?.commercialName ?? 'la empresa seleccionada'}.`;
  const canSave = mode === 'DEACTIVATE' ? confirmed && !!snapshot
    : !!company && !!alias.trim() && (mode !== 'REASSIGN' || (confirmed && company.id !== snapshot?.companyId)) && (!needsConfirmation || confirmed);

  return <Dialog open onClose={() => { if (!saving) onClose(); }} fullWidth maxWidth="sm" aria-labelledby="payment-file-dialog-title">
    <DialogTitle id="payment-file-dialog-title">{mode === 'DETAIL' ? 'Detalle del archivo' : mode === 'ASSIGN' ? 'Asignar alias permanente' : mode === 'REASSIGN' ? 'Cambiar empresa' : 'Desactivar alias'}</DialogTitle>
    <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
      <Typography fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{fileError.fileName}</Typography>
      <Typography variant="body2">Alias detectado: {fileError.detail ?? 'No disponible'}</Typography>
      <Typography variant="body2" color="text.secondary">Error histórico reportado por n8n: {fileError.errorCode}. No determina la asignación actual del catálogo.</Typography>
      {unavailable && <Alert severity="warning" action={<Button disabled={saving} onClick={() => void onSaved().catch(() => undefined)}>Actualizar</Button>}>Consulta el estado actual antes de gestionar el alias.</Alert>}
      {!unavailable && mode === 'DETAIL' && <>
        <Typography>Empresa asignada: {resolution?.company?.name ?? 'Ninguna'}</Typography>
        {active && <Typography color="info.main">Alias asignado · pendiente de reproceso</Typography>}
        {inactive && <Typography>Alias desactivado · empresa anterior: {resolution.assignment?.companyName}</Typography>}
        {resolution?.state === 'CONFLICT' && <Alert severity="warning">Hay coincidencias ambiguas en el catálogo. No se puede cambiar la asignación desde este archivo.</Alert>}
        {resolution?.state === 'NAME_ONLY' && <Alert severity="info">La empresa se reconoce por su nombre comercial, no por un alias independiente. Ese nombre no se cambia ni se desactiva desde aquí.</Alert>}
        {active && <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={() => start('REASSIGN')}>Cambiar empresa</Button>
          <Button color="warning" onClick={() => start('DEACTIVATE')}>Desactivar alias</Button>
        </Stack>}
        {resolution && (inactive || resolution.state === 'UNASSIGNED') && <Button variant="outlined" onClick={() => start('ASSIGN')}>Asignar alias</Button>}
      </>}
      {mode === 'REASSIGN' && <Typography>Asignación actual: {snapshot?.alias} → {snapshot?.companyName}</Typography>}
      {mode === 'DEACTIVATE' && <Alert severity="warning">Se conservará el registro y su auditoría con estatus INACTIVO. n8n dejará de utilizar este alias activo; los nombres comerciales y otros aliases de la empresa conservan sus propias reglas.</Alert>}
      {mode === 'ASSIGN' && <TextField label="Alias permanente" value={alias} disabled={saving} inputProps={{ maxLength: 300 }} onChange={(event) => {
        setAlias(event.target.value); setConfirmed(false); setNeedsConfirmation(false); setError(null);
      }} />}
      {searchEnabled && <Autocomplete options={options} value={company} inputValue={search} loading={loading} disabled={saving} filterOptions={(items) => items}
        isOptionEqualToValue={(a, b) => a.id === b.id} getOptionLabel={companyLabel}
        onInputChange={(_, value, reason) => { if (reason === 'input' || reason === 'clear') { setSearch(value); setCompany(null); setConfirmed(false); } }}
        onChange={(_, value) => { setCompany(value); setSearch(value ? companyLabel(value) : ''); setConfirmed(false); }}
        noOptionsText={search.trim().length < 2 ? 'Escribe al menos 2 caracteres' : 'No se encontraron empresas'} loadingText="Buscando empresas…"
        renderInput={(params) => <TextField {...params} label="Empresa existente" />} />}
      {searchError && <Alert severity="error">No fue posible buscar empresas. Vuelve a escribir para reintentar.</Alert>}
      {mode !== 'DETAIL' && <Typography variant="body2" color="text.secondary">Este cambio es permanente. No modifica procesamientos históricos ni ejecuta reprocesos.</Typography>}
      {needsConfirmation && <Alert severity="warning">Este alias parece un número de documento o identificador temporal.</Alert>}
      {(mode === 'REASSIGN' || mode === 'DEACTIVATE' || needsConfirmation) && <FormControlLabel
        control={<Checkbox checked={confirmed} disabled={saving} onChange={(_, value) => setConfirmed(value)} />} label={confirmation} />}
      {saved && !error && <Alert severity="success">Cambio guardado.</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
    </Stack></DialogContent>
    <DialogActions>
      {mode === 'DETAIL' ? <Button disabled={saving} onClick={onClose}>Cerrar</Button> : <>
        <Button disabled={saving} onClick={() => start('DETAIL')}>Cancelar</Button>
        <Button variant="contained" color={mode === 'DEACTIVATE' ? 'warning' : 'primary'} disabled={saving || unavailable || !canSave} onClick={() => void save()}>
          {saving ? 'Guardando…' : mode === 'DEACTIVATE' ? 'Confirmar desactivación' : mode === 'REASSIGN' ? 'Confirmar cambio' : 'Guardar alias'}
        </Button>
      </>}
    </DialogActions>
  </Dialog>;
}
