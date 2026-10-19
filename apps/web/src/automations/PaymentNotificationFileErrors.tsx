import { Alert, Box, Button, Chip, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { useState } from 'react';
import type { PaymentNotificationFileError } from '../services/paymentNotifications';
import { AssignPaymentAliasDialog } from './AssignPaymentAliasDialog';

interface PaymentNotificationFileErrorsProps {
  fileErrors: PaymentNotificationFileError[];
  titleId: string;
  unavailable?: boolean;
  onRefresh: () => Promise<void>;
}

// Current assignments arrive in the existing detail contract, not in temporary frontend state.
export function PaymentNotificationFileErrors({ fileErrors, titleId, unavailable = false, onRefresh }: PaymentNotificationFileErrorsProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = fileErrors.find((file) => file.fileHash + file.fileName === selectedKey);

  function stateLabel(item: PaymentNotificationFileError) {
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
    {unavailable && <Alert severity="warning" sx={{ mt: 1 }} action={<Button color="inherit" onClick={() => void onRefresh().catch(() => undefined)}>Actualizar</Button>}>Actualiza el detalle para confirmar la asignación vigente.</Alert>}
    <TableContainer component={Paper} variant="outlined" sx={{ mt: 2 }}>
      <Table size="small" aria-label="Archivos y asignación actual de aliases">
        <TableHead><TableRow><TableCell>Archivo</TableCell><TableCell>Alias detectado</TableCell><TableCell>Empresa asignada</TableCell><TableCell>Estado actual</TableCell><TableCell>Acciones</TableCell></TableRow></TableHead>
        <TableBody>{fileErrors.map((item) => {
          const resolution = item.aliasResolution;
          const assigned = resolution?.state === 'ACTIVE' || resolution?.state === 'NAME_ONLY';
          const assignable = resolution?.state === 'UNASSIGNED' || resolution?.state === 'INACTIVE';
          return <TableRow hover key={item.fileHash + item.fileName}>
            <TableCell sx={{ overflowWrap: 'anywhere' }}>{item.fileName}</TableCell>
            <TableCell sx={{ overflowWrap: 'anywhere' }}>{item.detail ?? '—'}</TableCell>
            <TableCell>{resolution?.company?.name ?? '—'}</TableCell>
            <TableCell><Stack spacing={0.5} alignItems="flex-start">
              <Chip size="small" variant="outlined" color={assigned ? 'info' : 'default'} label={stateLabel(item)} />
              {assigned && <Typography variant="caption" color="text.secondary">Pendiente de reproceso</Typography>}
              {resolution?.state === 'INACTIVE' && <Typography variant="caption">Alias desactivado</Typography>}
            </Stack></TableCell>
            <TableCell><Button size="small" onClick={() => setSelectedKey(item.fileHash + item.fileName)}>
              {unavailable ? 'Ver detalle' : assigned ? 'Gestionar alias' : assignable ? 'Asignar alias' : 'Ver detalle'}
            </Button></TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>
    </TableContainer>
    {selected && <AssignPaymentAliasDialog key={selected.fileHash + selected.fileName} fileError={selected}
      initialMode={!unavailable && ['UNASSIGNED', 'INACTIVE'].includes(selected.aliasResolution?.state ?? '') ? 'ASSIGN' : 'DETAIL'}
      resolution={selected.aliasResolution ?? null} unavailable={unavailable || !selected.aliasResolution}
      onClose={() => setSelectedKey(null)} onSaved={onRefresh} />}
  </Box>;
}
