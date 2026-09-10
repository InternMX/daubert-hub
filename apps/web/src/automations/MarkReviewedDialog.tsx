import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';

// Not destructive: acknowledging never modifies or deletes the underlying processing record
// (Phase 10I §18), so this deliberately uses the same restrained styling as every other
// confirmation dialog in the app (see DeactivateContactDialog) — never an error/destructive color.
// On failure the dialog stays open with a safe, retryable error (Phase 10I §20) instead of
// closing and silently discarding the still-outstanding review requirement.
export function MarkReviewedDialog({ open, automationName, submitting, error, onCancel, onConfirm }: { open: boolean; automationName: string; submitting: boolean; error: string | null; onCancel: () => void; onConfirm: () => void }) {
  return <Dialog open={open} onClose={() => !submitting && onCancel()} maxWidth="xs" fullWidth>
    <DialogTitle>Marcar como revisado</DialogTitle>
    <DialogContent>
      <Typography>
        Esta acción indica que el problema operativo actual de {automationName} ya fue revisado. No modifica ni elimina el procesamiento original.
      </Typography>
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
    </DialogContent>
    <DialogActions>
      <Button onClick={onCancel} disabled={submitting}>Cancelar</Button>
      <Button onClick={onConfirm} disabled={submitting} variant="contained">Marcar como revisado</Button>
    </DialogActions>
  </Dialog>;
}
