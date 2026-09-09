import { Chip } from '@mui/material';
import type { PaymentNotificationOutcomeStatus, PaymentNotificationResultStatus } from '../services/paymentNotifications';
import { outcomeStatusLabel, outcomeStatusSeverity, resultStatusLabels, resultStatusSeverity } from './paymentNotificationPresentation';

// Status is always conveyed by the label text (Completado/Parcial/Fallido/Sin resultado
// disponible, or Listo/Manual/Error/Omitido) — color is a restrained, secondary reinforcement
// only, never the sole signal (Phase 10C §23).
export function OutcomeStatusChip({ outcome }: { outcome: PaymentNotificationOutcomeStatus }) {
  return <Chip label={outcomeStatusLabel(outcome)} color={outcomeStatusSeverity(outcome)} size="small" />;
}

export function ResultStatusChip({ status }: { status: PaymentNotificationResultStatus }) {
  return <Chip label={resultStatusLabels[status]} color={resultStatusSeverity(status)} size="small" />;
}
