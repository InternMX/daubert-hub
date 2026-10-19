import { Alert, Autocomplete, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { searchCompanies, type CompanySearchResult } from '../services/companies';
import { assignPaymentAlias, type PermanentAliasAssignment } from '../services/companyAliases';
import type { PaymentNotificationFileError } from '../services/paymentNotifications';

const companyLabel = (item: CompanySearchResult) => `${item.commercialName} · ${item.rfc || item.companyType} · #${item.id}`;

export function AssignPaymentAliasDialog({ fileError, onClose, onAssigned }: {
  fileError: PaymentNotificationFileError;
  onClose: () => void;
  onAssigned: (assignment: PermanentAliasAssignment) => void;
}) {
  const [alias, setAlias] = useState(fileError.detail ?? '');
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<CompanySearchResult[]>([]);
  const [company, setCompany] = useState<CompanySearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let active = true;
    setOptions([]);
    setSearchError(false);
    if (search.trim().length < 2) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(() => {
      searchCompanies(search.trim()).then((results) => { if (active) setOptions(results); })
        .catch(() => { if (active) setSearchError(true); })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [search]);

  async function save() {
    if (!company || saving) return;
    setSaving(true);
    setError(null);
    try {
      onAssigned(await assignPaymentAlias(company.id, alias, confirmed));
    } catch (reason) {
      const api = reason as { code?: string; status?: number };
      if (api.code === 'PERMANENT_ALIAS_CONFIRMATION_REQUIRED') setNeedsConfirmation(true);
      else setError(api.code === 'ALIAS_ALREADY_ASSOCIATED'
        ? 'El alias coincide con un alias o nombre comercial de otra empresa. Revisa la selección.'
        : api.status === 403 ? 'No tienes permisos para asignar este alias.'
          : api.status === 401 ? 'Tu sesión expiró. Inicia sesión nuevamente.'
            : api.status === 400 ? 'Revisa el alias: debe contener letras o números y un máximo de 300 caracteres.'
              : 'No fue posible guardar el alias. Inténtalo nuevamente.');
    } finally { setSaving(false); }
  }

  return <Dialog open onClose={() => { if (!saving) onClose(); }} fullWidth maxWidth="sm" aria-labelledby="assign-payment-alias-title">
    <DialogTitle id="assign-payment-alias-title">Asignar alias permanente</DialogTitle>
    <DialogContent>
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography sx={{ overflowWrap: 'anywhere' }}>{fileError.fileName}</Typography>
        <TextField label="Alias detectado" value={alias} disabled={saving} inputProps={{ maxLength: 300 }} onChange={(event) => {
          setAlias(event.target.value); setConfirmed(false); setNeedsConfirmation(false); setError(null);
        }} />
        <Autocomplete options={options} value={company} inputValue={search} loading={loading} disabled={saving} filterOptions={(items) => items}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          getOptionLabel={companyLabel}
          onInputChange={(_, value, reason) => {
            if (reason === 'input' || reason === 'clear') { setSearch(value); setCompany(null); setConfirmed(false); }
          }} onChange={(_, value) => { setCompany(value); setSearch(value ? companyLabel(value) : ''); setConfirmed(false); }}
          noOptionsText={search.trim().length < 2 ? 'Escribe al menos 2 caracteres' : 'No se encontraron empresas'}
          loadingText="Buscando empresas…"
          renderInput={(params) => <TextField {...params} label="Empresa existente" />} />
        {searchError && <Alert severity="error">No fue posible buscar empresas. Vuelve a escribir para reintentar.</Alert>}
        <Alert severity="info">El alias identificará a esta empresa en futuros archivos. La disponibilidad en n8n depende de su configuración de Notificaciones de Pago. Guardar no reprocesa el correo.</Alert>
        {needsConfirmation && <Alert severity="warning">
          Este alias parece un número de documento o identificador temporal.
          <FormControlLabel control={<Checkbox checked={confirmed} disabled={saving} onChange={(_, value) => setConfirmed(value)} />}
            label={`Confirmo que este alias debe identificar permanentemente a ${company?.commercialName ?? 'la empresa'}.`} />
        </Alert>}
        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </DialogContent>
    <DialogActions>
      <Button disabled={saving} onClick={onClose}>Cancelar</Button>
      <Button variant="contained" disabled={saving || !company || !alias.trim() || (needsConfirmation && !confirmed)} onClick={() => void save()}>{saving ? 'Guardando…' : 'Guardar alias'}</Button>
    </DialogActions>
  </Dialog>;
}
