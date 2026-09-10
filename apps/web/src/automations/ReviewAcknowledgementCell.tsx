import { Button, Typography } from '@mui/material';
import { useState } from 'react';
import { acknowledgeAutomationReview } from '../services/automationsOverview';
import { MarkReviewedDialog } from './MarkReviewedDialog';

// Only the row the backend currently resolves as the outstanding problem carries a non-null
// reviewStatus (Phase 10I UX refinement §3/§4) — every older problematic row is `null` and renders
// as a plain "—", never a fabricated button or "Revisado" state. The frontend never decides this
// by comparing outcomes itself.
export type ReviewStatus = 'REQUIRED' | 'REVIEWED' | null;

interface ReviewAcknowledgementCellProps {
  automationCode: string;
  automationName: string;
  reviewStatus: ReviewStatus;
  // Called after a successful acknowledgement so the page can refresh the processing history
  // list, refresh automation-overview-derived state, and show its own success Snackbar (§6).
  onAcknowledged: () => void;
}

// No processing/source ID is ever read from `reviewStatus` or sent in the request (§5) —
// acknowledgeAutomationReview(automationCode) carries no body; the server resolves the current
// outstanding problem itself.
export function ReviewAcknowledgementCell({ automationCode, automationName, reviewStatus, onAcknowledged }: ReviewAcknowledgementCellProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (reviewStatus === 'REVIEWED') return <Typography color="text.secondary">Revisado</Typography>;
  if (reviewStatus !== 'REQUIRED') return <Typography color="text.secondary">—</Typography>;

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await acknowledgeAutomationReview(automationCode);
      setOpen(false);
      onAcknowledged();
    } catch {
      // Keep the row's action available and the review state visible (§6) — never optimistically
      // hide it, and never a raw API/PostgreSQL error.
      setError('No fue posible marcar la automatización como revisada. Intenta nuevamente.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button size="small" variant="outlined" onClick={() => { setError(null); setOpen(true); }}>Marcar como revisado</Button>
      <MarkReviewedDialog
        open={open}
        automationName={automationName}
        submitting={pending}
        error={error}
        onCancel={() => { if (!pending) { setOpen(false); setError(null); } }}
        onConfirm={() => void confirm()}
      />
    </>
  );
}
