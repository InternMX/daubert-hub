import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import { useRef, useState, type FormEvent } from 'react';
import {
  cancelAudiExecution, reconcileAudiExecution, reprocessAudiExecution, stopAudiExecution,
  type AudiExecutionDetail, type AudiRecoveryAction
} from '../services/audiExecutions';
import { audiActionLabel, audiRecoveryErrorMessage, audiRecoveryMessage } from './audiProcessingPresentation';

const consequences: Record<AudiRecoveryAction, string> = {
  REPROCESS: 'Reprocesar crea una nueva ejecución vinculada y usa folios nuevos.',
  RECONCILE: 'Reconciliar completa esta ejecución con sus folios originales si se verifica toda la evidencia.',
  STOP: 'Detener solicita que n8n pare. Cancelar es una acción distinta que cambia el estado de la ejecución.',
  CANCEL: 'Cancelar cambia el estado de la ejecución si se confirma la detención y el inventario está vacío. Detener solo solicita que n8n pare.'
};

export interface AudiRecoveryFeedback {
  severity: 'info' | 'error';
  message: string;
}

interface Props {
  detail: AudiExecutionDetail;
  action: AudiRecoveryAction;
  onClose: () => void;
  onSettled: (feedback: AudiRecoveryFeedback) => void;
}

export function AudiRecoveryActionDialog({ detail, action, onClose, onSettled }: Props) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const trimmedReason = reason.trim();
  const valid = trimmedReason.length >= 1 && trimmedReason.length <= 500;

  function close() {
    if (!pending.current) onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !valid) return;
    pending.current = true;
    setSaving(true);

    const id = detail.executionId;
    const revision = detail.revision ?? null;
    const request = {
      REPROCESS: () => reprocessAudiExecution(id, trimmedReason),
      RECONCILE: () => reconcileAudiExecution(id, trimmedReason, revision),
      STOP: () => stopAudiExecution(id, trimmedReason),
      CANCEL: () => cancelAudiExecution(id, trimmedReason, revision)
    }[action];
    let feedback: AudiRecoveryFeedback;
    try {
      const result = await request();
      feedback = { severity: result.accepted ? 'info' : 'error', message: audiRecoveryMessage(result.status) };
    } catch (error) {
      feedback = { severity: 'error', message: audiRecoveryErrorMessage(error) };
    }
    onSettled(feedback);
  }

  return <Dialog open onClose={close} fullWidth maxWidth="sm" aria-labelledby="audi-recovery-title">
    <Box component="form" noValidate onSubmit={submit}>
      <DialogTitle id="audi-recovery-title">{audiActionLabel[action]} ejecución</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">ID de ejecución: {detail.executionId}</Typography>
        <Typography sx={{ mt: 2 }}>{consequences[action]}</Typography>
        <Typography>Los folios consumidos no se reutilizan. Los archivos y la evidencia registrados no se eliminan.</Typography>
        <TextField sx={{ mt: 2.5 }} label="Motivo" required multiline minRows={3} fullWidth
          value={reason} onChange={(event) => setReason(event.target.value)} disabled={saving}
          helperText="Entre 1 y 500 caracteres." slotProps={{ htmlInput: { maxLength: 500 } }} />
      </DialogContent>
      <DialogActions>
        <Button type="button" onClick={close} disabled={saving}>Volver</Button>
        <Button type="submit" variant="contained" disabled={!valid || saving}>
          {saving ? 'Enviando…' : `Confirmar ${audiActionLabel[action].toLowerCase()}`}
        </Button>
      </DialogActions>
    </Box>
  </Dialog>;
}
