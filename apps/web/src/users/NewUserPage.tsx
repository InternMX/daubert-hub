import { Alert, Box, Button, CircularProgress, FormControl, InputLabel, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { PageHeader } from '../components/PageHeader';
import { PasswordVisibilityToggle } from '../components/PasswordVisibilityToggle';
import { createUser, describeUsersApiError, UsersApiError, type UserRole } from '../services/users';
import { roleLabels } from '../services/userLabels';
import { GeneratePasswordActions } from './GeneratePasswordActions';

const MIN_PASSWORD_LENGTH = 12;
const GENERIC_ERROR_MESSAGE = 'No fue posible crear el usuario. Inténtalo nuevamente.';

type FieldErrors = Partial<Record<'displayName' | 'email' | 'temporaryPassword' | 'confirmPassword', string>>;

function validate(displayName: string, email: string, temporaryPassword: string, confirmPassword: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!displayName.trim()) errors.displayName = 'Ingresa el nombre.';
  if (!email.trim()) errors.email = 'Ingresa el correo electrónico.';
  if (temporaryPassword.length < MIN_PASSWORD_LENGTH) errors.temporaryPassword = `La contraseña temporal debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (confirmPassword !== temporaryPassword) errors.confirmPassword = 'Las contraseñas no coinciden.';
  return errors;
}

export function NewUserPage() {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('GENERAL');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  function applyGeneratedPassword(generated: string) {
    setTemporaryPassword(generated);
    setConfirmPassword(generated);
    setFieldErrors((current) => ({ ...current, temporaryPassword: undefined, confirmPassword: undefined }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const errors = validate(displayName, email, temporaryPassword, confirmPassword);
    setFieldErrors(errors);
    setSubmitError(null);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const user = await createUser({ displayName: displayName.trim(), email: email.trim(), role, temporaryPassword });
      navigate(`/users/${user.id}`, { state: { successMessage: 'Usuario creado correctamente.' } });
    } catch (caught) {
      if (caught instanceof UsersApiError && caught.code === 'USER_EMAIL_CONFLICT') {
        setFieldErrors({ email: caught.message });
      } else {
        setSubmitError(describeUsersApiError(caught, GENERIC_ERROR_MESSAGE));
      }
      setSubmitting(false);
    }
  }

  return (
    <>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Usuarios', to: '/users' }, { label: 'Nuevo usuario' }]} />
      <PageHeader title="Nuevo usuario" description="Crea una cuenta de acceso a Daubert Hub.">
        <Button variant="text" onClick={() => navigate('/users')}>Volver a usuarios</Button>
      </PageHeader>
      <Box component="form" noValidate onSubmit={submit} sx={{ maxWidth: 640, mt: 4 }}>
        <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
          <Stack spacing={2.5}>
            {submitError && <Alert severity="error">{submitError}</Alert>}
            <TextField
              label="Nombre"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              error={Boolean(fieldErrors.displayName)}
              helperText={fieldErrors.displayName}
              fullWidth
              autoFocus
              disabled={submitting}
            />
            <TextField
              label="Correo electrónico"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={Boolean(fieldErrors.email)}
              helperText={fieldErrors.email}
              fullWidth
              autoComplete="off"
              disabled={submitting}
            />
            <FormControl fullWidth disabled={submitting}>
              <InputLabel id="new-user-role-label">Rol</InputLabel>
              <Select labelId="new-user-role-label" label="Rol" value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
                {(Object.keys(roleLabels) as UserRole[]).map((value) => <MenuItem key={value} value={value}>{roleLabels[value]}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField
              label="Contraseña temporal"
              type={showPassword ? 'text' : 'password'}
              value={temporaryPassword}
              onChange={(event) => setTemporaryPassword(event.target.value)}
              error={Boolean(fieldErrors.temporaryPassword)}
              helperText={fieldErrors.temporaryPassword ?? `Mínimo ${MIN_PASSWORD_LENGTH} caracteres.`}
              fullWidth
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
            <GeneratePasswordActions password={temporaryPassword} onGenerate={applyGeneratedPassword} disabled={submitting} />
            <Typography variant="body2" color="text.secondary">El usuario deberá cambiar esta contraseña en su primer inicio de sesión.</Typography>
          </Stack>
        </Paper>
        <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1.5} justifyContent="flex-end" sx={{ mt: 2 }}>
          <Button component={Link} to="/users" disabled={submitting}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={submitting} startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}>{submitting ? 'Creando...' : 'Crear usuario'}</Button>
        </Stack>
      </Box>
    </>
  );
}
