import { Alert, Box, Button, Chip, CircularProgress, Paper, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatActivityTimestamp } from '../components/activityTimestamp';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { listUsers, type ManagedUser } from '../services/users';
import { roleLabels, userStatusLabels } from '../services/userLabels';

function RoleChip({ role }: { role: ManagedUser['role'] }) {
  return <Chip label={roleLabels[role]} size="small" variant="outlined" color={role === 'ADMIN' ? 'primary' : 'default'} />;
}

function StatusChip({ status }: { status: ManagedUser['status'] }) {
  const active = status === 'ACTIVE';
  return <Chip label={userStatusLabels[status]} size="small" sx={active ? { bgcolor: 'success.light', color: 'success.dark', fontWeight: 700 } : { bgcolor: 'action.hover', color: 'text.secondary' }} />;
}

export function UsersPage() {
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    listUsers()
      .then((response) => { if (active) setUsers(response); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);

  return (
    <>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Usuarios' }]} />
      <PageHeader title="Usuarios" description="Administra las cuentas con acceso a Daubert Hub.">
        <Button component={Link} to="/users/new" variant="contained">Nuevo usuario</Button>
      </PageHeader>
      {loading && <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress aria-label="Cargando usuarios" /></Box>}
      {!loading && error && <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>} sx={{ mt: 4, maxWidth: 760 }}>No fue posible cargar los usuarios. Intenta nuevamente.</Alert>}
      {!loading && !error && users?.length === 0 && (
        <EmptyState title="Aún no hay usuarios registrados." description="Crea el primer usuario para comenzar." />
      )}
      {!loading && !error && users && users.length > 0 && (
        <Paper variant="outlined" sx={{ mt: 4, maxWidth: 1200, overflow: 'hidden' }}>
          <Box sx={{ overflowX: 'auto' }}>
            <Table aria-label="Usuarios">
              <TableHead>
                <TableRow>
                  <TableCell>Nombre</TableCell>
                  <TableCell>Correo</TableCell>
                  <TableCell>Rol</TableCell>
                  <TableCell>Estado</TableCell>
                  <TableCell>Cambio de contraseña pendiente</TableCell>
                  <TableCell>Último acceso</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id} hover>
                    <TableCell><Link to={`/users/${user.id}`}>{user.displayName}</Link></TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell><RoleChip role={user.role} /></TableCell>
                    <TableCell><StatusChip status={user.status} /></TableCell>
                    <TableCell>{user.mustChangePassword ? 'Sí' : 'No'}</TableCell>
                    <TableCell>{user.lastLoginAt ? formatActivityTimestamp(user.lastLoginAt) : 'Nunca'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
          <Typography color="text.secondary" sx={{ px: 2, py: 1.5 }}>{users.length} {users.length === 1 ? 'usuario' : 'usuarios'}</Typography>
        </Paper>
      )}
    </>
  );
}
