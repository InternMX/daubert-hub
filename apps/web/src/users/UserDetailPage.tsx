import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Paper, Stack, Tooltip, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../auth/authContext.core';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { roleLabels, userStatusLabels } from '../services/userLabels';
import { deactivateUser, describeUsersApiError, getUser, reactivateUser, UsersApiError, type ManagedUser } from '../services/users';
import { MANUFACTURING_UI_VISIBLE } from '../automations/automationRoutes';
import { FirmasAdministrativas } from '../firmas/FirmasAdministrativas';
import { ResetPasswordDialog } from './ResetPasswordDialog';

function DetailField({ label, value }: { label: string; value: string }) {
  return <Box><Typography variant="overline" color="text.secondary">{label}</Typography><Typography>{value}</Typography></Box>;
}

function formatTimestamp(value: string | null): string {
  if (!value) return 'Nunca';
  return new Date(value).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' });
}

export function UserDetailPage() {
  const { userId = '' } = useParams();
  const location = useLocation();
  const { user: authUser } = useAuth();
  const successMessage = typeof location.state === 'object' && location.state !== null && 'successMessage' in location.state && typeof location.state.successMessage === 'string' ? location.state.successMessage : null;

  const [user, setUser] = useState<ManagedUser | null>(null);
  const [error, setError] = useState<UsersApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resettingPassword, setResettingPassword] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getUser(userId)
      .then((response) => { if (active) setUser(response); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof UsersApiError ? reason : new UsersApiError(0, undefined)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, retry]);

  if (loading) return <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress aria-label="Cargando usuario" /></Box>;

  if (error?.status === 404) {
    return <><PageHeader title="Usuario no encontrado" /><EmptyState title="No se encontró el usuario solicitado." description="Es posible que ya no esté disponible." /><Button component={Link} to="/users" sx={{ mt: 3 }}>Volver a usuarios</Button></>;
  }

  if (error || !user) {
    return <><PageHeader title="Usuario" /><Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>} sx={{ mt: 4, maxWidth: 760 }}>No fue posible cargar el usuario. Intenta nuevamente.</Alert><Button component={Link} to="/users" sx={{ mt: 3 }}>Volver a usuarios</Button></>;
  }

  const isSelf = authUser?.id === user.id;
  const isActive = user.status === 'ACTIVE';

  async function changeStatus() {
    setChangingStatus(true);
    setActionError(null);
    try {
      const updated = isActive ? await deactivateUser(user!.id) : await reactivateUser(user!.id);
      setUser(updated);
      setConfirming(false);
    } catch (caught) {
      setActionError(describeUsersApiError(caught, 'No fue posible actualizar el estado del usuario. Intenta nuevamente.'));
    } finally {
      setChangingStatus(false);
    }
  }

  return (
    <>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Usuarios', to: '/users' }, { label: user.displayName }]} />
      <PageHeader title={user.displayName} description="Detalle del usuario.">
        <Button component={Link} to={`/users/${user.id}/edit`} variant="contained">Editar usuario</Button>
        <Tooltip title={isSelf ? 'No puedes desactivar tu propia cuenta.' : ''}>
          <span>
            <Button
              color={isActive ? 'warning' : 'success'}
              variant="outlined"
              disabled={isSelf && isActive}
              onClick={() => { setActionError(null); setConfirming(true); }}
            >
              {isActive ? 'Desactivar' : 'Reactivar'}
            </Button>
          </span>
        </Tooltip>
        <Tooltip title={isSelf ? 'Usa el cambio de contraseña de tu cuenta.' : ''}>
          <span>
            <Button variant="outlined" disabled={isSelf} onClick={() => { setActionError(null); setResettingPassword(true); }}>Restablecer contraseña</Button>
          </span>
        </Tooltip>
        <Button component={Link} to="/users">Volver a usuarios</Button>
      </PageHeader>
      <Stack spacing={2} sx={{ mt: 4, maxWidth: 960 }}>
        {successMessage && <Alert severity="success">{successMessage}</Alert>}
        {actionError && <Alert severity="error">{actionError}</Alert>}
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
          <Typography variant="h2" sx={{ fontSize: '1.125rem' }}>Información general</Typography>
          <Stack spacing={2.5} sx={{ mt: 2 }}>
            <DetailField label="Nombre" value={user.displayName} />
            <DetailField label="Correo" value={user.email} />
            <DetailField label="Rol" value={roleLabels[user.role]} />
            <DetailField label="Estado" value={userStatusLabels[user.status]} />
            <DetailField label="Cambio de contraseña pendiente" value={user.mustChangePassword ? 'Sí' : 'No'} />
            <DetailField label="Último acceso" value={formatTimestamp(user.lastLoginAt)} />
            <DetailField label="Fecha de creación" value={formatTimestamp(user.createdAt)} />
            <DetailField label="Última actualización" value={formatTimestamp(user.updatedAt)} />
          </Stack>
        </Paper>
        {MANUFACTURING_UI_VISIBLE && (
          <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
            <FirmasAdministrativas consulta={{ propietarioUsuarioId: user.id }} propietarioNuevo={isActive ? { tipo: 'usuario', id: user.id, nombre: user.displayName } : null} titulo="Firmas" />
          </Paper>
        )}
      </Stack>
      <Dialog open={confirming} onClose={() => !changingStatus && setConfirming(false)}>
        <DialogTitle>{isActive ? 'Desactivar usuario' : 'Reactivar usuario'}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {isActive
              ? 'El usuario perderá acceso inmediatamente y se cerrarán sus sesiones activas.'
              : 'El usuario podrá iniciar sesión de nuevo con su contraseña existente. Reactivar no inicia una sesión automáticamente.'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button disabled={changingStatus} onClick={() => setConfirming(false)}>Cancelar</Button>
          <Button color={isActive ? 'warning' : 'success'} disabled={changingStatus} onClick={() => void changeStatus()}>{isActive ? 'Desactivar' : 'Reactivar'}</Button>
        </DialogActions>
      </Dialog>
      <ResetPasswordDialog
        open={resettingPassword}
        userId={user.id}
        onClose={() => setResettingPassword(false)}
        onSuccess={(updated) => { setUser(updated); setResettingPassword(false); }}
      />
    </>
  );
}
