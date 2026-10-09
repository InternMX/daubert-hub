import { Alert, Box, Button, Chip, CircularProgress, ListSubheader, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { formatActivityTimestamp } from '../components/activityTimestamp';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { auditActionLabels, auditEntityOptions, dayStartIso, listAuditEvents, nextDayStartIso, type AuditAction, type AuditEventsPage } from '../services/audit';
import { listUsers, type ManagedUser } from '../services/users';
import { AuditEventDrawer } from './AuditEventDrawer';
import { auditActorLabel } from './auditPresentation';

const PAGE_SIZE = 25;

interface Filters {
  from: string;
  to: string;
  userId: string;
  entity: string;
  action: '' | AuditAction;
}

const emptyFilters: Filters = { from: '', to: '', userId: '', entity: '', action: '' };

const actionColors: Record<AuditAction, 'success' | 'info' | 'error'> = { CREATE: 'success', UPDATE: 'info', DELETE: 'error' };

export function AuditPage() {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AuditEventsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const invalidRange = filters.from !== '' && filters.to !== '' && filters.from > filters.to;

  // Best-effort: the user filter simply stays empty if the list cannot load.
  useEffect(() => { let active = true; listUsers().then((list) => { if (active) setUsers(list); }).catch(() => undefined); return () => { active = false; }; }, []);

  useEffect(() => {
    if (invalidRange) return;
    let active = true;
    setLoading(true); setError(false);
    listAuditEvents({
      page,
      pageSize: PAGE_SIZE,
      from: filters.from ? dayStartIso(filters.from) : undefined,
      to: filters.to ? nextDayStartIso(filters.to) : undefined,
      userId: filters.userId || undefined,
      entity: filters.entity || undefined,
      action: filters.action || undefined
    })
      .then((response) => { if (active) setResult(response); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters, page, retry, invalidRange]);

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  const hasFilters = Object.values(filters).some((value) => value !== '');
  const events = result?.data ?? [];
  const meta = result?.meta;

  return (
    <>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Auditoría' }]} />
      <PageHeader title="Auditoría" description="Consulta los cambios registrados en Daubert Hub: quién los hizo, cuándo y qué cambió." />

      <Paper variant="outlined" component="section" aria-label="Filtros de auditoría" sx={{ mt: 4, p: 2, maxWidth: 1200 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} useFlexGap flexWrap="wrap">
          <TextField label="Desde" type="date" size="small" value={filters.from} onChange={(event) => updateFilter('from', event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label="Hasta" type="date" size="small" value={filters.to} onChange={(event) => updateFilter('to', event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField select label="Usuario" size="small" value={filters.userId} onChange={(event) => updateFilter('userId', event.target.value)} sx={{ minWidth: 200 }}>
            <MenuItem value="">Todos</MenuItem>
            {users.map((user) => <MenuItem key={user.id} value={user.id}>{user.displayName}</MenuItem>)}
          </TextField>
          <TextField select label="Entidad" size="small" value={filters.entity} onChange={(event) => updateFilter('entity', event.target.value)} sx={{ minWidth: 220 }}>
            <MenuItem value="">Todas</MenuItem>
            {/* Module headings are visual only (ListSubheader is not selectable); option values stay the API entity keys. */}
            {auditEntityOptions.flatMap((group) => [
              <ListSubheader key={`group-${group.module}`} sx={{ textTransform: 'uppercase', fontWeight: 700, lineHeight: '32px' }}>{group.module}</ListSubheader>,
              ...group.options.map((option) => <MenuItem key={option.key} value={option.key} sx={{ pl: 4 }}>{option.label}</MenuItem>)
            ])}
          </TextField>
          <TextField select label="Acción" size="small" value={filters.action} onChange={(event) => updateFilter('action', event.target.value as Filters['action'])} sx={{ minWidth: 160 }}>
            <MenuItem value="">Todas</MenuItem>
            {(Object.keys(auditActionLabels) as AuditAction[]).map((action) => <MenuItem key={action} value={action}>{auditActionLabels[action]}</MenuItem>)}
          </TextField>
          <Button onClick={() => { setFilters(emptyFilters); setPage(1); }} disabled={!hasFilters}>Limpiar filtros</Button>
        </Stack>
        {invalidRange && <Alert severity="warning" sx={{ mt: 2 }}>La fecha inicial debe ser anterior o igual a la fecha final.</Alert>}
      </Paper>

      {!invalidRange && loading && <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress aria-label="Cargando auditoría" /></Box>}
      {!invalidRange && !loading && error && <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>} sx={{ mt: 4, maxWidth: 760 }}>No fue posible cargar la auditoría. Intenta nuevamente.</Alert>}
      {!invalidRange && !loading && !error && events.length === 0 && (
        <EmptyState title={hasFilters ? 'No hay eventos con estos filtros.' : 'Aún no hay eventos de auditoría.'} description={hasFilters ? 'Prueba ampliando el rango de fechas o limpiando los filtros.' : 'Los cambios que se registren aparecerán aquí.'} />
      )}
      {!invalidRange && !loading && !error && events.length > 0 && meta && (
        <Paper variant="outlined" sx={{ mt: 3, maxWidth: 1200, overflow: 'hidden' }}>
          <Box sx={{ overflowX: 'auto' }}>
            <Table aria-label="Eventos de auditoría">
              <TableHead>
                <TableRow>
                  <TableCell>Fecha</TableCell>
                  <TableCell>Usuario</TableCell>
                  <TableCell>Módulo</TableCell>
                  <TableCell>Acción</TableCell>
                  <TableCell>Entidad</TableCell>
                  <TableCell>Registro</TableCell>
                  <TableCell><span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Detalle</span></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatActivityTimestamp(event.occurredAt)}</TableCell>
                    <TableCell>{auditActorLabel(event.actor)}</TableCell>
                    <TableCell>{event.category.label}</TableCell>
                    <TableCell><Chip size="small" color={actionColors[event.action]} variant="outlined" label={auditActionLabels[event.action]} /></TableCell>
                    <TableCell>{event.entity.label}</TableCell>
                    <TableCell>{event.record.label ?? event.record.reference ?? '—'}</TableCell>
                    <TableCell><Button size="small" onClick={() => setSelectedId(event.id)} aria-label={`Ver detalle del evento ${event.id}`}>Ver detalle</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end" sx={{ p: 1.5 }}>
            <Typography variant="body2" color="text.secondary">
              {(meta.page - 1) * meta.pageSize + 1}–{Math.min(meta.page * meta.pageSize, meta.total)} de {meta.total}
            </Typography>
            <Button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</Button>
            <Button disabled={page >= meta.totalPages} onClick={() => setPage((value) => value + 1)}>Siguiente</Button>
          </Stack>
        </Paper>
      )}

      <AuditEventDrawer eventId={selectedId} onClose={() => setSelectedId(null)} />
    </>
  );
}
