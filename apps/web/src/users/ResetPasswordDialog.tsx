import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, Stack, TextField } from '@mui/material';
import { useEffect, useState } from 'react';
import { PasswordVisibilityToggle } from '../components/PasswordVisibilityToggle';
import { describeUsersApiError, resetPassword, type ManagedUser } from '../services/users';
import { GeneratePasswordActions } from './GeneratePasswordActions';

const MIN_PASSWORD_LENGTH = 12;
const GENERIC_ERROR_MESSAGE = 'No fue posible restablecer la contraseña. Inténtalo nuevamente.';

interface ResetPasswordDialogProps {
  open: boolean;
  userId: string;
  onClose: () => void;
  onSuccess: (user: ManagedUser) => void;
}

type FieldErrors = Partial<Record<'newPassword' | 'confirmPassword', string>>;

function validate(newPassword: string, confirmPassword: string): FieldErrors {
  const errors: FieldErrors = {};
  if (newPassword.length < MIN_PASSWORD_LENGTH) errors.newPassword = `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (confirmPassword !== newPassword) errors.confirmPassword = 'Las contraseñas no coinciden.';
  return errors;
}

export function ResetPasswordDialog({ open, userId, onClose, onSuccess }: ResetPasswordDialogProps) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  function clear() {
    setNewPassword('');
    setConfirmPassword('');
    setFieldErrors({});
    setSubmitError(null);
    setShowPassword(false);
  }

  function applyGeneratedPassword(generated: string) {
    setNewPassword(generated);
    setConfirmPassword(generated);
    setFieldErrors((current) => ({ ...current, newPassword: undefined, confirmPassword: undefined }));
  }

  // Password fields never outlive the dialog being open: cleared whenever it
  // closes, regardless of whether that was Cancel, a successful reset, or
  // the parent unmounting this component.
  useEffect(() => {
    if (!open) clear();
  }, [open]);

  function handleClose() {
    if (submitting) return;
    onClose();
  }

  async function submit() {
    const errors = validate(newPassword, confirmPassword);
    setFieldErrors(errors);
    setSubmitError(null);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const updated = await resetPassword(userId, newPassword);
      clear();
      onSuccess(updated);
    } catch (caught) {
      setSubmitError(describeUsersApiError(caught, GENERIC_ERROR_MESSAGE));
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>Las sesiones activas del usuario se cerrarán y deberá cambiar esta contraseña al volver a iniciar sesión.</DialogContentText>
        <Stack spacing={2.5}>
          {submitError && <Alert severity="error">{submitError}</Alert>}
          <TextField
            label="Nueva contraseña temporal"
            type={showPassword ? 'text' : 'password'}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            error={Boolean(fieldErrors.newPassword)}
            helperText={fieldErrors.newPassword ?? `Mínimo ${MIN_PASSWORD_LENGTH} caracteres.`}
            fullWidth
            autoFocus
            autoComplete="new-password"
            disabled={submitting}
            slotProps={{
              input: {
                endAdornment: <PasswordVisibilityToggle visible={showPassword} onToggle={() => setShowPassword((value) => !value)} disabled={submitting} />
              }
            }}
          />
          <TextField
            label="Confirmar contraseña temporal"
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            error={Boolean(fieldErrors.confirmPassword)}
            helperText={fieldErrors.confirmPassword}
            fullWidth
            autoComplete="new-password"
            disabled={submitting}
          />
          <GeneratePasswordActions password={newPassword} onGenerate={applyGeneratedPassword} disabled={submitting} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={submitting} onClick={handleClose}>Cancelar</Button>
        <Button variant="contained" disabled={submitting} startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined} onClick={() => void submit()}>{submitting ? 'Guardando...' : 'Restablecer contraseña'}</Button>
      </DialogActions>
    </Dialog>
  );
}
