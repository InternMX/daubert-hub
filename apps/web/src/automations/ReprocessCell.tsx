import { Button } from '@mui/material';
import { useState } from 'react';
import { PaymentNotificationApiError, reprocessPaymentNotifications, type PaymentNotificationProcessingStatus } from '../services/paymentNotifications';
import { ReprocessDialog } from './ReprocessDialog';

interface ReprocessCellProps {
  executionId: string;
  reprocessAvailable: boolean;
  // PN1.2 production findings §4: while an execution is still PENDIENTE, Reprocesar must not be
  // presented as actionable — n8n's own workflow already refuses a second claim, but the UI should
  // represent that truthfully rather than offering an action that would only be rejected. This adds
  // no new backend lock; it is a presentational guard alongside reprocessAvailable.
  processingStatus: PaymentNotificationProcessingStatus;
  // Called after a successful reprocess request so the page can refresh the processing history
  // and show its own success Snackbar (PN1.2 §11). Reprocessing never acknowledges review — this
  // is a completely independent action from ReviewAcknowledgementCell (PN1.2 §6/§13).
  onReprocessed: () => void;
}

// A 202 only means Hub→n8n delivery succeeded, never that business processing finished (PN1.2
// final semantics §6) — so a request failure (this function) is a different thing from n8n later
// failing the workflow, which surfaces only through the read model. Messages stay sanitized: never
// the raw PaymentNotificationApiError/status text or an underlying fetch error.
function reprocessErrorMessage(error: unknown): string {
  if (error instanceof PaymentNotificationApiError) {
    if (error.status === 409) return 'Esta ejecución ya no se puede reprocesar.';
    if (error.status === 404) return 'La ejecución solicitada ya no está disponible.';
    if (error.status === 502 || error.status === 503) return 'El servicio de automatización no está disponible en este momento. Intenta nuevamente más tarde.';
  }
  return 'No fue posible solicitar el reproceso. Intenta nuevamente.';
}

// PN1.2 targeting fix: reprocess is per-execution, so this cell forwards the row's own public
// executionId — never derived from list ordering — to reprocessPaymentNotifications(). No
// correo_id is ever read from props or sent in the request (PN1.2 §5): the server resolves that
// execution's internal correo_id itself, exactly like ReviewAcknowledgementCell/
// acknowledgeAutomationReview.
export function ReprocessCell({ executionId, reprocessAvailable, processingStatus, onReprocessed }: ReprocessCellProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A 202 means only that the request was accepted, never that processing finished (PN1.2 final
  // semantics §3/§4) — so this never becomes "completed"/"successful"/"processed". It exists only
  // to stop the same rendered row from being submitted again before authoritative data (a later
  // read, or revisiting/refreshing the page) is available; it is not a backend lock or a state
  // machine, and n8n remains the actual concurrency/idempotency authority.
  const [requestAccepted, setRequestAccepted] = useState(false);

  if (!reprocessAvailable || processingStatus === 'PENDIENTE') return null;

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await reprocessPaymentNotifications(executionId);
      setOpen(false);
      setRequestAccepted(true);
      onReprocessed();
    } catch (reason) {
      setError(reprocessErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button size="small" variant="outlined" disabled={requestAccepted} onClick={() => { setError(null); setOpen(true); }}>Reprocesar</Button>
      <ReprocessDialog
        open={open}
        submitting={pending}
        error={error}
        onCancel={() => { if (!pending) { setOpen(false); setError(null); } }}
        onConfirm={() => void confirm()}
      />
    </>
  );
}
