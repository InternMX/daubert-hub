import { Alert, Box, Button, CircularProgress, FormControl, FormControlLabel, FormHelperText, FormLabel, InputLabel, MenuItem, Paper, Radio, RadioGroup, Select, Stack, Switch, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { CreateProviderInput, ProviderType } from '../services/providers';
import { InfoTooltip } from '../components/InfoTooltip';
import { PROCESSES_RECEIPTS_HELP } from '../components/paymentNotificationHelp';
import { DropboxPathField } from './DropboxPathField';

// Extra step requested with "Configurar ahora". Pure UI intent: it is never sent to the backend as a flag.
// Only `processesPaymentReceipts` is applied afterwards through the existing payment-notification-settings PATCH.
export interface PaymentNotificationSetup {
  processesPaymentReceipts: boolean;
}

type SetupMode = 'LATER' | 'NOW';

interface ProviderFormProps {
  // The second argument is present only when the user chose "Configurar ahora".
  onSubmit: (input: CreateProviderInput, paymentSetup?: PaymentNotificationSetup) => Promise<void>;
  onCancel: () => void;
}

type FieldErrors = Partial<Record<'commercialName' | 'providerType' | 'fiscal' | 'rfc' | 'rutaDropbox', string>>;

const providerOptions: { value: ProviderType; label: string }[] = [
  { value: 'PROVEEDOR', label: 'Proveedor' },
  { value: 'SERVICIO', label: 'Proveedor de servicios' },
  { value: 'FLETE', label: 'Flete' }
];

function validate(commercialName: string, providerType: string, legalName: string, rfc: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!commercialName.trim()) errors.commercialName = 'Ingresa el nombre comercial.';
  if (!providerType) errors.providerType = 'Selecciona el tipo de proveedor.';
  const hasLegalName = Boolean(legalName.trim());
  const hasRfc = Boolean(rfc.trim());
  if (hasLegalName !== hasRfc) errors.fiscal = 'Para registrar datos fiscales, completa la razón social y el RFC.';
  if (hasRfc && (/\s/.test(rfc.trim()) || ![12, 13].includes(rfc.trim().length))) errors.rfc = 'Ingresa un RFC de 12 o 13 caracteres sin espacios.';
  return errors;
}

function FormSection({ title, optional, children }: { title: string; optional?: boolean; children: ReactNode }) {
  return (
    <Paper component="section" variant="outlined" sx={{ p: { xs: 2.5, sm: 3 }, borderRadius: 1 }}>
      <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 2.5 }}>
        <Typography variant="h2" sx={{ fontSize: '1.125rem' }}>{title}</Typography>
        {optional && <Typography variant="body2" color="text.secondary">Opcional</Typography>}
      </Stack>
      {children}
    </Paper>
  );
}

export function ProviderForm({ onSubmit, onCancel }: ProviderFormProps) {
  const [commercialName, setCommercialName] = useState('');
  const [providerType, setProviderType] = useState<ProviderType | ''>('');
  const [legalName, setLegalName] = useState('');
  const [rfc, setRfc] = useState('');
  const [notes, setNotes] = useState('');
  const [rutaDropbox, setRutaDropbox] = useState('');
  // UI-only state (never persisted): LATER is the default and keeps the form exactly as it was.
  const [setupMode, setSetupMode] = useState<SetupMode>('LATER');
  const [processesReceipts, setProcessesReceipts] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const nextErrors = validate(commercialName, providerType, legalName, rfc);
    setErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length > 0 || !providerType) return;
    const trimmedLegalName = legalName.trim();
    const trimmedRfc = rfc.trim().toUpperCase();
    setSubmitting(true);
    try {
      const setupNow = setupMode === 'NOW';
      const input: CreateProviderInput = {
        commercialName: commercialName.trim(),
        providerType,
        fiscal: trimmedLegalName && trimmedRfc ? { legalName: trimmedLegalName, rfc: trimmedRfc } : null,
        notes: notes.trim() || null,
        // Hidden fields are never submitted: the path only applies while "Configurar ahora" is selected.
        ...(setupNow && rutaDropbox.trim() ? { rutaDropbox: rutaDropbox.trim() } : {})
      };
      if (setupNow) await onSubmit(input, { processesPaymentReceipts: processesReceipts });
      else await onSubmit(input);
    } catch (error) {
      const apiError = error as { code?: string; requestId?: string | null };
      if (apiError.code === 'PROVIDER_NAME_ALREADY_EXISTS') {
        setErrors({ commercialName: 'Ya existe un proveedor o empresa con ese nombre comercial.' });
      } else if (apiError.code?.startsWith('DROPBOX_PATH_')) {
        setErrors({ rutaDropbox: 'Ingresa una ruta relativa a Dropbox válida (sin unidad, servidor, «..» ni caracteres no permitidos).' });
      } else if (apiError.code === 'RFC_ALREADY_EXISTS') {
        setErrors({ rfc: 'Ya existe una empresa registrada con ese RFC.' });
      } else {
        setSubmitError(`No fue posible registrar el proveedor. Inténtalo nuevamente.${apiError.requestId ? ` Referencia: ${apiError.requestId}` : ''}`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box component="form" noValidate onSubmit={submit} sx={{ maxWidth: 840, mt: 4 }}>
      <Stack spacing={2}>
        {submitError && <Alert severity="error">{submitError}</Alert>}
        <FormSection title="Información general">
          <Stack spacing={2.5}>
            <TextField label="Nombre comercial" required value={commercialName} onChange={(event) => setCommercialName(event.target.value)} error={Boolean(errors.commercialName)} helperText={errors.commercialName} fullWidth autoFocus />
            <FormControl fullWidth required error={Boolean(errors.providerType)}>
              <InputLabel id="provider-type-label">Tipo de proveedor</InputLabel>
              <Select labelId="provider-type-label" label="Tipo de proveedor" value={providerType} onChange={(event) => setProviderType(event.target.value as ProviderType)}>
                {providerOptions.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
              </Select>
              {errors.providerType && <FormHelperText>{errors.providerType}</FormHelperText>}
            </FormControl>
          </Stack>
        </FormSection>
        <FormSection title="Datos fiscales" optional>
          <Stack spacing={2.5}>
            <Typography variant="body2" color="text.secondary">Puedes registrar esta información más adelante.</Typography>
            <TextField label="Razón social" value={legalName} onChange={(event) => setLegalName(event.target.value)} error={Boolean(errors.fiscal)} helperText={errors.fiscal} fullWidth />
            <TextField label="RFC" value={rfc} onChange={(event) => setRfc(event.target.value.toUpperCase())} error={Boolean(errors.rfc)} helperText={errors.rfc} fullWidth />
          </Stack>
        </FormSection>
        <FormSection title="Notificaciones de pago" optional>
          <Stack spacing={2.5}>
            <FormControl>
              <FormLabel id="payment-setup-label">¿Deseas configurar las notificaciones de pago ahora?</FormLabel>
              <RadioGroup aria-labelledby="payment-setup-label" value={setupMode} onChange={(event) => setSetupMode(event.target.value as SetupMode)}>
                <FormControlLabel value="LATER" control={<Radio />} label="Configurar después" />
                <FormControlLabel value="NOW" control={<Radio />} label="Configurar ahora" />
              </RadioGroup>
            </FormControl>
            <Typography variant="body2" color="text.secondary">Puedes configurar las notificaciones de pago más tarde desde la ficha del proveedor.</Typography>
            {setupMode === 'NOW' && (
              <Stack spacing={2.5}>
                <DropboxPathField value={rutaDropbox} onChange={setRutaDropbox} error={errors.rutaDropbox} helperText="Ruta relativa a Dropbox, por ejemplo FLETES/TRANSPORTES KARINA." companyType={providerType} commercialName={commercialName} suggestionLabel="Sugerencia de ruta" />
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <FormControlLabel control={<Switch checked={processesReceipts} onChange={(event) => setProcessesReceipts(event.target.checked)} />} label="Procesa comprobantes" sx={{ mr: 0 }} />
                  <InfoTooltip label="Procesa comprobantes" text={PROCESSES_RECEIPTS_HELP} />
                </Stack>
                <Typography variant="body2" color="text.secondary">Los destinatarios de correo se configuran después de crear el proveedor.</Typography>
                <Typography variant="body2" color="text.secondary">La configuración no activa automáticamente las notificaciones. Podrás activarlas desde la ficha del proveedor cuando todos los requisitos estén completos.</Typography>
              </Stack>
            )}
          </Stack>
        </FormSection>
        <FormSection title="Información adicional" optional>
          <TextField label="Observaciones" value={notes} onChange={(event) => setNotes(event.target.value)} multiline minRows={4} fullWidth />
        </FormSection>
        <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1.5} justifyContent="flex-end" sx={{ pt: 1 }}>
          <Button type="button" variant="text" onClick={onCancel} disabled={submitting}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={submitting} startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}>{submitting ? 'Guardando...' : setupMode === 'NOW' ? 'Guardar y continuar' : 'Guardar proveedor'}</Button>
        </Stack>
      </Stack>
    </Box>
  );
}
