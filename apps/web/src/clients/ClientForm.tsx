import { Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { CreateClientInput } from '../services/clients';

interface ClientFormProps {
  onSubmit: (input: CreateClientInput) => Promise<void>;
  onCancel: () => void;
}

type FieldErrors = Partial<Record<'commercialName' | 'fiscal' | 'rfc', string>>;

function validate(commercialName: string, legalName: string, rfc: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!commercialName.trim()) errors.commercialName = 'Ingresa el nombre comercial.';
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

export function ClientForm({ onSubmit, onCancel }: ClientFormProps) {
  const [commercialName, setCommercialName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [rfc, setRfc] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const nextErrors = validate(commercialName, legalName, rfc);
    setErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length > 0) return;
    const trimmedLegalName = legalName.trim();
    const trimmedRfc = rfc.trim().toUpperCase();
    setSubmitting(true);
    try {
      await onSubmit({
        commercialName: commercialName.trim(),
        fiscal: trimmedLegalName && trimmedRfc ? { legalName: trimmedLegalName, rfc: trimmedRfc } : null,
        notes: notes.trim() || null
      });
    } catch (error) {
      const apiError = error as { code?: string; requestId?: string | null };
      if (apiError.code === 'CLIENT_ALREADY_ACTIVE') {
        setErrors({ commercialName: 'Ya existe un cliente activo con ese nombre comercial.' });
      } else if (apiError.code === 'CLIENT_NAME_RFC_CONFLICT') {
        setErrors({ commercialName: 'El nombre comercial pertenece a una empresa con una identidad fiscal diferente o sin confirmar.' });
      } else if (apiError.code === 'CLIENT_RFC_CONFLICT') {
        setErrors({ rfc: 'Ya existe una empresa registrada con ese RFC.' });
      } else if (apiError.code === 'CLIENT_NAME_CONFLICT') {
        setErrors({ commercialName: 'Ya existe una empresa con ese nombre comercial.' });
      } else {
        setSubmitError(`No fue posible registrar el cliente. Inténtalo nuevamente.${apiError.requestId ? ` Referencia: ${apiError.requestId}` : ''}`);
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
          <TextField label="Nombre comercial" required value={commercialName} onChange={(event) => setCommercialName(event.target.value)} error={Boolean(errors.commercialName)} helperText={errors.commercialName} fullWidth autoFocus />
        </FormSection>
        <FormSection title="Datos fiscales" optional>
          <Stack spacing={2.5}>
            <Typography variant="body2" color="text.secondary">Puedes registrar esta información más adelante.</Typography>
            <TextField label="Razón social" value={legalName} onChange={(event) => setLegalName(event.target.value)} error={Boolean(errors.fiscal)} helperText={errors.fiscal} fullWidth />
            <TextField label="RFC" value={rfc} onChange={(event) => setRfc(event.target.value.toUpperCase())} error={Boolean(errors.rfc)} helperText={errors.rfc} fullWidth />
          </Stack>
        </FormSection>
        <FormSection title="Información adicional" optional>
          <TextField label="Observaciones" value={notes} onChange={(event) => setNotes(event.target.value)} multiline minRows={4} fullWidth />
        </FormSection>
        <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1.5} justifyContent="flex-end" sx={{ pt: 1 }}>
          <Button type="button" variant="text" onClick={onCancel} disabled={submitting}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={submitting} startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}>{submitting ? 'Guardando...' : 'Guardar cliente'}</Button>
        </Stack>
      </Stack>
    </Box>
  );
}
