import { Alert, Box, Button, CircularProgress, Divider, Drawer, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { formatActivityTimestamp } from '../components/activityTimestamp';
import { auditActionLabels, getAuditEvent, type AuditEventDetail } from '../services/audit';
import { auditActorLabel, auditOriginLabel } from './auditPresentation';

interface AuditEventDrawerProps {
  eventId: string | null;
  onClose: () => void;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <Box><Typography variant="caption" color="text.secondary">{label}</Typography><Typography sx={{ overflowWrap: 'anywhere' }}>{value}</Typography></Box>;
}

const emptyValue = <Typography component="span" color="text.secondary">—</Typography>;

export function AuditEventDrawer({ eventId, onClose }: AuditEventDrawerProps) {
  const [event, setEvent] = useState<AuditEventDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    let active = true;
    setLoading(true); setError(false); setEvent(null);
    getAuditEvent(eventId)
      .then((result) => { if (active) setEvent(result); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [eventId]);

  return (
    <Drawer anchor="right" open={eventId !== null} onClose={onClose} slotProps={{ paper: { 'aria-label': 'Detalle del evento de auditoría', sx: { width: { xs: '100%', sm: 520 }, p: 3 } } }}>
      <Stack spacing={2}>
        <Typography variant="h2" sx={{ fontSize: '1.25rem' }}>Detalle del evento</Typography>
        {loading && <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={24} aria-label="Cargando detalle" /></Box>}
        {error && <Alert severity="error">No fue posible cargar el detalle del evento.</Alert>}
        {event && <>
          <Stack spacing={1.5}>
            <Detail label="Fecha" value={formatActivityTimestamp(event.occurredAt)} />
            <Detail label="Usuario" value={auditActorLabel(event.actor)} />
            <Detail label="Origen" value={auditOriginLabel(event.origin)} />
            <Detail label="Módulo" value={event.category.label} />
            <Detail label="Acción" value={auditActionLabels[event.action]} />
            <Detail label="Entidad" value={event.entity.label} />
            <Detail label="Registro" value={event.record.label ? `${event.record.label} (${event.record.reference ?? 'sin referencia'})` : event.record.reference ?? 'Sin referencia'} />
            {event.requestId && <Detail label="Solicitud (request_id)" value={event.requestId} />}
          </Stack>
          <Divider />
          <Typography variant="subtitle1" fontWeight={700}>Cambios</Typography>
          {event.changes.length === 0
            ? <Typography color="text.secondary">Este evento no tiene campos visibles para mostrar.</Typography>
            : <Table size="small" aria-label="Cambios del evento">
              <TableHead><TableRow><TableCell>Campo</TableCell><TableCell>Antes</TableCell><TableCell>Después</TableCell></TableRow></TableHead>
              <TableBody>{event.changes.map((change) => (
                <TableRow key={change.field}>
                  <TableCell>{change.label}</TableCell>
                  <TableCell sx={{ overflowWrap: 'anywhere' }}>{change.before ?? emptyValue}</TableCell>
                  <TableCell sx={{ overflowWrap: 'anywhere' }}>{change.after ?? emptyValue}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>}
        </>}
        <Button onClick={onClose} sx={{ alignSelf: 'flex-start' }}>Cerrar</Button>
      </Stack>
    </Drawer>
  );
}
