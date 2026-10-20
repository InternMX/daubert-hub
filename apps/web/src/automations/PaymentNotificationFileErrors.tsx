import { Alert, Box, Button, Chip, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { useState } from 'react';
import type { PaymentNotificationFileError } from '../services/paymentNotifications';
import { AssignPaymentAliasDialog } from './AssignPaymentAliasDialog';

interface PaymentNotificationFileErrorsProps {
  fileErrors: PaymentNotificationFileError[];
  titleId: string;
  executionId?: string;
  unavailable?: boolean;
  onRefresh: () => Promise<void>;
}

// Current assignments arrive in the existing detail contract, not in temporary frontend state.
export function PaymentNotificationFileErrors({ fileErrors, titleId, executionId, unavailable = false, onRefresh }: PaymentNotificationFileErrorsProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Index suffix is a React display key only; all mutations require the trusted server fileId.
  const keyOf = (file: PaymentNotificationFileError, index: number) => file.fileAssignment?.fileId ?? `${file.fileHash}${file.fileName}:${index}`;
  const selected = fileErrors.find((file, index) => keyOf(file, index) === selectedKey);

  function stateLabel(item: PaymentNotificationFileError) {
    if (item.fileAssignment?.assignment?.status === 'ACTIVA') return 'Asignado solo a este archivo';
    if (!['ALIAS_NO_CATALOGADO', 'ALIAS_AMBIGUO'].includes(item.errorCode)) return 'Requiere revisión';
    if (unavailable || !item.aliasResolution) return 'Estado no disponible';
    switch (item.aliasResolution.state) {
      case 'ACTIVE': return 'Asignado';
      case 'INACTIVE': return 'Sin asignar';
      case 'CONFLICT': return 'Conflicto de alias';
      case 'NAME_ONLY': return 'Asignado';
      default: return 'Sin asignar';
    }
  }

  if (fileErrors.length === 0) return null;
  return <Box component="section" aria-labelledby={titleId}>
    <Typography id={titleId} variant="h2">Archivos que requieren atención</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Asignación actual del catálogo. El error reportado por n8n se consulta en el detalle de cada archivo.</Typography>
    {fileErrors.some((file) => file.fileAssignment?.assignment?.status === 'ACTIVA') && <Alert severity="info" sx={{ mt: 1 }}>{fileErrors.some((file) => file.fileAssignment?.n8nReady) ? 'Las asignaciones puntuales se aplican al reprocesar este correo solo si todos los archivos asignados son seguros.' : 'La integración n8n de asignaciones puntuales está pendiente. El reproceso de este correo está bloqueado mientras existan asignaciones puntuales activas.'}</Alert>}
    {unavailable && <Alert severity="warning" sx={{ mt: 1 }} action={<Button color="inherit" onClick={() => void onRefresh().catch(() => undefined)}>Actualizar</Button>}>Actualiza el detalle para confirmar la asignación vigente.</Alert>}
    <TableContainer component={Paper} variant="outlined" sx={{ mt: 2 }}>
      <Table size="small" aria-label="Archivos y asignación actual de aliases">
        <TableHead><TableRow><TableCell>Archivo</TableCell><TableCell>Alias detectado</TableCell><TableCell>Empresa asignada</TableCell><TableCell>Estado actual</TableCell><TableCell>Acciones</TableCell></TableRow></TableHead>
        <TableBody>{fileErrors.map((item, index) => {
          const resolution = item.aliasResolution;
          const point = item.fileAssignment?.assignment;
          const pointActive = point?.status === 'ACTIVA';
          const assigned = pointActive || resolution?.state === 'ACTIVE' || resolution?.state === 'NAME_ONLY';
          const assignable = resolution?.state === 'UNASSIGNED' || resolution?.state === 'INACTIVE';
          return <TableRow hover key={keyOf(item, index)}>
            <TableCell sx={{ overflowWrap: 'anywhere' }}>{item.fileName}</TableCell>
            <TableCell sx={{ overflowWrap: 'anywhere' }}>{item.detail ?? '—'}</TableCell>
            <TableCell>{pointActive ? point.companyName : resolution?.company?.name ?? '—'}</TableCell>
            <TableCell><Stack spacing={0.5} alignItems="flex-start">
              <Chip size="small" variant="outlined" color={assigned ? 'info' : 'default'} label={stateLabel(item)} />
              {assigned && <Typography variant="caption" color="text.secondary">Pendiente de reproceso</Typography>}
              {resolution?.state === 'INACTIVE' && <Typography variant="caption">Alias desactivado</Typography>}
              {point?.status === 'REVOCADA' && <Typography variant="caption">Asignación puntual revocada</Typography>}
            </Stack></TableCell>
            <TableCell><Button size="small" color="inherit" onClick={() => setSelectedKey(keyOf(item, index))}>
              {unavailable ? 'Ver detalle' : pointActive ? 'Gestionar asignación' : assigned ? 'Gestionar alias' : item.fileAssignment?.enabled ? 'Asignar empresa' : assignable ? 'Asignar alias' : 'Ver detalle'}
            </Button></TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>
    </TableContainer>
    {selected && <AssignPaymentAliasDialog key={selectedKey!} fileError={selected} executionId={executionId}
      initialMode={!unavailable && !selected.fileAssignment?.enabled && ['UNASSIGNED', 'INACTIVE'].includes(selected.aliasResolution?.state ?? '') ? 'ASSIGN' : 'DETAIL'}
      resolution={selected.aliasResolution ?? null} unavailable={unavailable || !selected.aliasResolution}
      onClose={() => setSelectedKey(null)} onSaved={onRefresh} />}
  </Box>;
}
