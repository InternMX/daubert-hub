import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import { useState, type FormEvent } from 'react';
import { regenerateCaterpillarExecution, type CaterpillarRegenerationResult } from '../services/caterpillarRemissions';
import { caterpillarRegenerationErrorMessage } from './caterpillarPresentation';

const REASON_MAX_LENGTH = 500;

interface CaterpillarRegenerateDialogProps {
  open: boolean;
  executionId: string;
  sourceFilename: string;
  onClose: () => void;
  onRegenerated: (result: CaterpillarRegenerationResult) => void;
}

// Commercial regeneration is NOT a technical reprocess: it is offered only for a completed execution whose remissions were all cancelled formally, it
// records the authorizing administrator and the reason, and it can authorize exactly one new emission. The Hub/PostgreSQL decide; this dialog only
// collects the mandatory reason and shows whatever the backend answers (a stale or ineligible execution is always rejected visibly).
export function CaterpillarRegenerateDialog(props: CaterpillarRegenerateDialogProps) {
  return props.open ? <CaterpillarRegenerateForm key={props.executionId} {...props} /> : null;
}

function CaterpillarRegenerateForm({ open, executionId, sourceFilename, onClose, onRegenerated }: CaterpillarRegenerateDialogProps) {
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = reason.trim().length > 0 && !saving;

  function close() {
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
      onRegenerated(await regenerateCaterpillarExecution(executionId, trimmedReason));
    } catch (err) {
      setError(caterpillarRegenerationErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <Box component="form" noValidate onSubmit={submit}>
        <DialogTitle>Regenerar remisiones</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">ID de ejecución: {executionId}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>Archivo: {sourceFilename}</Typography>
          <Alert severity="warning" sx={{ mt: 2 }}>
            Esto autoriza una sola emisión nueva. Se creará una ejecución nueva con folios nuevos; la ejecución original y sus remisiones canceladas se conservan.
            Quedará registrado tu usuario y el motivo. Volver a cargar o modificar el Excel no genera una regeneración por sí solo.
          </Alert>
          <TextField
            sx={{ mt: 2.5 }}
            label="Motivo de la regeneración"
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
          <Button type="button" onClick={close} disabled={saving}>Cancelar</Button>
          <Button type="submit" variant="contained" color="warning" disabled={!canSubmit}>{saving ? 'Autorizando...' : 'Autorizar y regenerar'}</Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
