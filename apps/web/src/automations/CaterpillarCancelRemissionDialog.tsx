import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { useState, type FormEvent } from 'react';
import { cancelCaterpillarRemission, CaterpillarCancellationApiError, type CaterpillarCancelResult, type CaterpillarRemittance } from '../services/caterpillarRemissions';

export function CaterpillarCancelRemissionDialog({ executionId, remission, onClose, onCancelled }: {
  executionId: string;
  remission: CaterpillarRemittance;
  onClose: () => void;
  onCancelled: (result: CaterpillarCancelResult) => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || stale || !reason.trim() || !remission.revision) return;
    setSaving(true);
    setError(null);
    try {
      const result = await cancelCaterpillarRemission(executionId, remission.remissionId, reason.trim(), remission.revision);
      onCancelled(result);
    } catch (err) {
      const status = err instanceof CaterpillarCancellationApiError ? err.status : 0;
      if (status === 409) setStale(true);
      const messages: Record<number, string> = {
        403: 'No tienes permisos para cancelar esta remisión.',
        404: 'La remisión ya no está disponible en esta ejecución.',
        409: 'La remisión cambió o no es elegible. Cierra este diálogo y actualiza el detalle.'
      };
      setError(messages[status] ?? 'No fue posible confirmar la cancelación. Actualiza el detalle antes de reintentar.');
    } finally { setSaving(false); }
  }
  return <Dialog open onClose={() => { if (!saving) onClose(); }} fullWidth maxWidth="sm">
    <Box component="form" onSubmit={submit}>
      <DialogTitle>Cancelar remisión Caterpillar</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        <Typography>Folio: {remission.folio} · Serie: {remission.seriesCode}</Typography>
        <Typography>Ejecución: {executionId} · Remisión: {remission.remissionId}</Typography>
        <Typography>Proceso: {remission.processLabel ?? 'Proceso no determinado'}</Typography>
        <Typography>Estado: {remission.status}</Typography>
        <Alert severity="warning">La cancelación no recupera folios ni modifica consecutivos o reservas. Se conservarán el detalle y el PDF original. No verifica si el documento fue enviado al cliente.</Alert>
        <TextField label="Motivo de cancelación" value={reason} onChange={(event) => setReason(event.target.value)} required
          multiline minRows={3} fullWidth disabled={saving} slotProps={{ htmlInput: { maxLength: 500 } }} helperText="Máximo 500 caracteres." />
        {error && <Alert severity="error">{error}</Alert>}
      </Stack></DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Volver</Button>
        <Button type="submit" color="error" variant="contained" disabled={saving || stale || !reason.trim() || !remission.revision}>
          {saving ? 'Cancelando...' : 'Confirmar cancelación'}
        </Button>
      </DialogActions>
    </Box>
  </Dialog>;
}
