import { Alert, Box, Button, CircularProgress, FormControl, InputLabel, MenuItem, Paper, Select, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/authContext.core';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { roleLabels } from '../services/userLabels';
import { describeUsersApiError, getUser, updateUser, UsersApiError, type ManagedUser, type UserRole } from '../services/users';

const GENERIC_ERROR_MESSAGE = 'No fue posible actualizar el usuario. Inténtalo nuevamente.';

export function EditUserPage() {
  const { userId = '' } = useParams();
  const navigate = useNavigate();
  const { user: authUser, refreshUser } = useAuth();
  const isSelf = authUser?.id === userId;

  const [user, setUser] = useState<ManagedUser | null>(null);
  const [error, setError] = useState<UsersApiError | null>(null);
  const [retry, setRetry] = useState(0);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('GENERAL');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setError(null);
    getUser(userId).then((value) => {
      if (!active) return;
      setUser(value);
      setDisplayName(value.displayName);
      setEmail(value.email);
      setRole(value.role);
    }).catch((reason: unknown) => { if (active) setError(reason instanceof UsersApiError ? reason : new UsersApiError(0, undefined)); });
    return () => { active = false; };
  }, [userId, retry]);

  if (error?.status === 404) return <><PageHeader title="Usuario no encontrado" /><EmptyState title="No se encontró el usuario solicitado." description="Es posible que ya no esté disponible." /><Button component={Link} to="/users" sx={{ mt: 3 }}>Volver a usuarios</Button></>;
  if (error) return <><PageHeader title="Editar usuario" /><Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>} sx={{ mt: 4 }}>No fue posible cargar el usuario. Intenta nuevamente.</Alert></>;
  if (!user) return <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress aria-label="Cargando usuario" /></Box>;

  const changed = displayName.trim() !== user.displayName || email.trim() !== user.email || role !== user.role;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = displayName.trim();
    const trimmedEmail = email.trim();
    if (!name) return setFieldError('Ingresa el nombre.');
    if (!trimmedEmail) return setFieldError('Ingresa el correo electrónico.');
    setFieldError(null);
    setSaving(true);
    try {
      // The backend rejects ANY self-targeting role field, even one equal to
      // the current value (see UsersService.updateUser) — the role Select is
      // disabled for isSelf above, so role is never included in that case.
      await updateUser(userId, isSelf ? { displayName: name, email: trimmedEmail } : { displayName: name, email: trimmedEmail, role });
      if (isSelf) {
        // refreshUser() reconciles against /auth/me directly and resolves to
        // null when the session is gone (a self email change revokes it) —
        // AuthContext has already cleared the authenticated user by then, and
        // the existing route guards take it from there. A network hiccup here
        // (refreshUser rejecting) is ambiguous, not proof of anything, so it's
        // treated the same as a successful refresh: proceed to the detail page.
        const refreshed = await refreshUser().catch(() => undefined);
        if (refreshed === null) return;
      }
      navigate(`/users/${userId}`, { state: { successMessage: 'Usuario actualizado correctamente.' } });
    } catch (caught) {
      if (caught instanceof UsersApiError && caught.code === 'USER_EMAIL_CONFLICT') {
        setFieldError(caught.message);
      } else {
        setFieldError(describeUsersApiError(caught, GENERIC_ERROR_MESSAGE));
      }
      setSaving(false);
    }
  }

  return (
    <>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Usuarios', to: '/users' }, { label: user.displayName, to: `/users/${userId}` }, { label: 'Editar' }]} />
      <PageHeader title="Editar usuario" description="Actualiza la información del usuario.">
        <Button component={Link} to={`/users/${userId}`}>Volver al detalle</Button>
      </PageHeader>
      <Box component="form" noValidate onSubmit={submit} sx={{ maxWidth: 640, mt: 4 }}>
        <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
          <Stack spacing={2.5}>
            {fieldError && <Alert severity="error">{fieldError}</Alert>}
            <TextField label="Nombre" disabled={saving} value={displayName} onChange={(event) => setDisplayName(event.target.value)} fullWidth autoFocus />
            <TextField label="Correo" type="email" disabled={saving} value={email} onChange={(event) => setEmail(event.target.value)} fullWidth autoComplete="off" />
            <Tooltip title={isSelf ? 'No puedes cambiar tu propio rol.' : ''}>
              <FormControl fullWidth disabled={saving || isSelf}>
                <InputLabel id="edit-user-role-label">Rol</InputLabel>
                <Select labelId="edit-user-role-label" label="Rol" value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
                  {(Object.keys(roleLabels) as UserRole[]).map((value) => <MenuItem key={value} value={value}>{roleLabels[value]}</MenuItem>)}
                </Select>
              </FormControl>
            </Tooltip>
            {isSelf && <Typography variant="body2" color="text.secondary">Si cambias tu correo, tu sesión actual se cerrará y deberás iniciar sesión de nuevo.</Typography>}
          </Stack>
        </Paper>
        <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1.5} justifyContent="flex-end" sx={{ mt: 2 }}>
          <Button type="button" disabled={saving} onClick={() => navigate(`/users/${userId}`)}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={saving || !changed} startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}>{saving ? 'Guardando...' : 'Guardar cambios'}</Button>
        </Stack>
      </Box>
    </>
  );
}
