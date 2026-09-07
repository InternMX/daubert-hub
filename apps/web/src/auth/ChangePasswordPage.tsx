import { Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from '@mui/material';
import { useState, type FormEvent } from 'react';
import { AuthApiError } from '../services/auth';
import { useAuth } from './authContext.core';

const MIN_PASSWORD_LENGTH = 12;
const GENERIC_ERROR_MESSAGE = 'No se pudo cambiar la contraseña. Inténtalo nuevamente.';

type FieldErrors = Partial<Record<'currentPassword' | 'newPassword' | 'confirmPassword', string>>;

// Mirrors the backend's minimum-length rule for immediate feedback, but never
// replaces it — the backend (password-policy.ts) remains the source of truth
// and is re-checked on submit regardless of what passes here.
function validate(currentPassword: string, newPassword: string, confirmPassword: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!currentPassword) errors.currentPassword = 'Ingresa tu contraseña actual.';
  if (newPassword.length < MIN_PASSWORD_LENGTH) errors.newPassword = `La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (confirmPassword !== newPassword) errors.confirmPassword = 'Las contraseñas no coinciden.';
  return errors;
}

export function ChangePasswordPage() {
  const { changePassword, user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const errors = validate(currentPassword, newPassword, confirmPassword);
    setFieldErrors(errors);
    setSubmitError(null);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      // On success, AuthContext's updated user (mustChangePassword=false)
      // flows into ChangePasswordRoute, which redirects into the
      // application — no navigation happens here.
    } catch (caught) {
      if (caught instanceof AuthApiError && caught.message) {
        setSubmitError(caught.message);
      } else {
        setSubmitError(GENERIC_ERROR_MESSAGE);
      }
      setSubmitting(false);
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default', px: 2 }}>
      <Paper variant="outlined" sx={{ width: '100%', maxWidth: 440, p: { xs: 3, sm: 4 }, borderTop: '4px solid', borderTopColor: 'primary.main' }}>
        <Typography variant="h1" sx={{ fontSize: '1.375rem' }}>Actualiza tu contraseña</Typography>
        <Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>
          {user ? `${user.displayName}, debes` : 'Debes'} establecer una nueva contraseña antes de continuar.
        </Typography>
        <Box component="form" noValidate onSubmit={submit}>
          <Stack spacing={2.5}>
            {submitError && <Alert severity="error">{submitError}</Alert>}
            <TextField
              label="Contraseña actual"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              error={Boolean(fieldErrors.currentPassword)}
              helperText={fieldErrors.currentPassword}
              fullWidth
              autoFocus
              autoComplete="current-password"
              disabled={submitting}
            />
            <TextField
              label="Nueva contraseña"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              error={Boolean(fieldErrors.newPassword)}
              helperText={fieldErrors.newPassword ?? `Mínimo ${MIN_PASSWORD_LENGTH} caracteres.`}
              fullWidth
              autoComplete="new-password"
              disabled={submitting}
            />
            <TextField
              label="Confirmar nueva contraseña"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              error={Boolean(fieldErrors.confirmPassword)}
              helperText={fieldErrors.confirmPassword}
              fullWidth
              autoComplete="new-password"
              disabled={submitting}
            />
            <Button
              type="submit"
              variant="contained"
              fullWidth
              disabled={submitting}
              startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {submitting ? 'Guardando...' : 'Guardar nueva contraseña'}
            </Button>
          </Stack>
        </Box>
      </Paper>
    </Box>
  );
}
