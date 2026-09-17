import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';

// Same restrained, non-destructive styling as MarkReviewedDialog — reprocessing retries business
// processing, it does not delete or discard anything. The copy is deliberately honest about scope
// (PN1.2 correction §12): it promises only that already-completed work is not intentionally
// regenerated, never that the retry has already succeeded — 202 means n8n accepted the request,
// not that reevaluation finished (the workflow itself later reflects the outcome).
export function ReprocessDialog({ open, submitting, error, onCancel, onConfirm }: { open: boolean; submitting: boolean; error: string | null; onCancel: () => void; onConfirm: () => void }) {
  return <Dialog open={open} onClose={() => !submitting && onCancel()} maxWidth="xs" fullWidth>
    <DialogTitle>Reprocesar correo</DialogTitle>
    <DialogContent>
      <Typography>
        Se reevaluará el correo con la información actual. El trabajo que ya se completó correctamente no se volverá a generar intencionalmente.
      </Typography>
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
    </DialogContent>
    <DialogActions>
      <Button onClick={onCancel} disabled={submitting}>Cancelar</Button>
      <Button onClick={onConfirm} disabled={submitting} variant="contained">Reprocesar</Button>
    </DialogActions>
  </Dialog>;
}
