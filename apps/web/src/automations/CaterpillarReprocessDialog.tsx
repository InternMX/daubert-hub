import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import { useState, type FormEvent } from 'react';
import { reprocessCaterpillarExecution, type CaterpillarExecutionOutcome, type CaterpillarReprocessResult } from '../services/caterpillarRemissions';
import { caterpillarOutcomeLabel, caterpillarReprocessErrorMessage } from './caterpillarPresentation';

const REASON_MAX_LENGTH = 500;

interface CaterpillarReprocessDialogProps {
  open: boolean;
  executionId: string;
  outcome: CaterpillarExecutionOutcome;
  sourceFilename: string;
  onClose: () => void;
  onReprocessed: (result: CaterpillarReprocessResult) => void;
}

// Phase 12C: the Hub/n8n/PostgreSQL contract is the real authority — this dialog's ERROR/CANCELADA
// gating (in the caller, CaterpillarRemissionsPage) is UX only, never security. A stale or
// already-changed execution can still be rejected by the backend after this dialog is opened, and
// that rejection is always shown, never hidden or silently retried.
//
// Deliberately never says folios will be reused — the backend always reserves fresh folios for the
// new execution (see caterpillar-reprocess-webhook.client.ts / the n8n workflow), and the original
// execution is never mutated or reopened.
export function CaterpillarReprocessDialog({ open, executionId, outcome, sourceFilename, onClose, onReprocessed }: CaterpillarReprocessDialogProps) {
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = reason.trim().length > 0 && !saving;

  function resetAndClose() {
    if (saving) return;
    setReason('');
    setReasonError(false);
    setError(null);
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmedReason = reason.trim();
    if (!trimmedReason) { setReasonError(true); return; }

    setSaving(true);
    setError(null);
    try {
      const result = await reprocessCaterpillarExecution(executionId, trimmedReason);
      onReprocessed(result);
      // No local reset here — onReprocessed() closes this dialog, and a fresh open (a new
      // executionId, or the same one clicked again) always starts from an empty form.
    } catch (err) {
      // The backend already sanitizes this message — displayed as-is, never a raw upstream body,
      // stack trace, URL, or token (CaterpillarReprocessApiError never carries any of those).
      setError(caterpillarReprocessErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={resetAndClose} fullWidth maxWidth="sm">
      <Box component="form" noValidate onSubmit={submit}>
        <DialogTitle>Reprocesar ejecución</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">ID de ejecución: {executionId}</Typography>
          <Typography variant="body2" color="text.secondary">Estado actual: {caterpillarOutcomeLabel(outcome)}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>Archivo: {sourceFilename}</Typography>
          <Typography sx={{ mt: 2 }}>
            Se creará una nueva ejecución vinculada a la original. La ejecución original no será modificada.
          </Typography>
          <TextField
            sx={{ mt: 2.5 }}
            label="Motivo del reproceso"
            value={reason}
            onChange={(event) => { setReason(event.target.value); if (event.target.value.trim()) setReasonError(false); }}
            required
            multiline
            minRows={3}
            fullWidth
            error={reasonError}
            helperText={reasonError ? 'El motivo es obligatorio.' : `Máximo ${REASON_MAX_LENGTH} caracteres.`}
            slotProps={{ htmlInput: { maxLength: REASON_MAX_LENGTH } }}
          />
          {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button type="button" onClick={resetAndClose} disabled={saving}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={!canSubmit}>{saving ? 'Reprocesando...' : 'Reprocesar'}</Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
