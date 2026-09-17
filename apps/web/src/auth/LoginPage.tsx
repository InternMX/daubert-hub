import { Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from '@mui/material';
import { useState, type FormEvent } from 'react';
import { PasswordVisibilityToggle } from '../components/PasswordVisibilityToggle';
import { AuthApiError } from '../services/auth';
import { useAuth } from './authContext.core';

const INVALID_CREDENTIALS_MESSAGE = 'Correo o contraseña incorrectos.';
const GENERIC_ERROR_MESSAGE = 'No se pudo iniciar sesión. Inténtalo nuevamente.';
const RATE_LIMITED_FALLBACK_MESSAGE = 'Demasiados intentos de inicio de sesión. Intenta nuevamente más tarde.';
const logoUrl = 'https://daubertcromwell.com/wp-content/uploads/daubertcromwell_2lines.png';

export function LoginPage() {
  const { login, hydrationFailed } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      // On success, AuthContext's updated user flows into PublicOnlyRoute,
      // which redirects away from this page — no navigation happens here.
    } catch (caught) {
      // Never logs the password or any technical/database detail — only a
      // fixed message per known status is ever shown. A 429 renders the
      // backend's own restrained Spanish message (falling back to a local
      // copy if it's ever missing), never a raw/technical error.
      if (caught instanceof AuthApiError && caught.status === 401) {
        setError(INVALID_CREDENTIALS_MESSAGE);
      } else if (caught instanceof AuthApiError && caught.status === 429) {
        setError(caught.message || RATE_LIMITED_FALLBACK_MESSAGE);
      } else {
        setError(GENERIC_ERROR_MESSAGE);
      }
      setSubmitting(false);
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default', px: 2 }}>
      <Paper variant="outlined" sx={{ width: '100%', maxWidth: 400, p: { xs: 3, sm: 4 }, borderTop: '4px solid', borderTopColor: 'primary.main' }}>
        <Box sx={{ bgcolor: 'common.white', p: 1.5, borderRadius: 0.5, mb: 3, maxWidth: 220, mx: 'auto' }}>
          <Box component="img" src={logoUrl} alt="Daubert Cromwell" sx={{ display: 'block', width: '100%', height: 'auto' }} />
        </Box>
        <Typography variant="h1" sx={{ fontSize: '1.375rem', textAlign: 'center' }}>Daubert Hub</Typography>
        <Typography color="text.secondary" sx={{ mt: 1, mb: 3, textAlign: 'center' }}>Inicia sesión para continuar.</Typography>
        {hydrationFailed && <Alert severity="warning" sx={{ mb: 2 }}>No se pudo verificar tu sesión. Inicia sesión para continuar.</Alert>}
        <Box component="form" noValidate onSubmit={submit}>
          <Stack spacing={2.5}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Correo electrónico"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              fullWidth
              autoFocus
              autoComplete="email"
              disabled={submitting}
            />
            <TextField
              label="Contraseña"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              fullWidth
              autoComplete="current-password"
              disabled={submitting}
              slotProps={{
                input: {
                  endAdornment: <PasswordVisibilityToggle visible={showPassword} onToggle={() => setShowPassword((value) => !value)} disabled={submitting} />
                }
              }}
            />
            <Button
              type="submit"
              variant="contained"
              fullWidth
              disabled={submitting}
              startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {submitting ? 'Iniciando sesión...' : 'Iniciar sesión'}
            </Button>
          </Stack>
        </Box>
      </Paper>
    </Box>
  );
}
