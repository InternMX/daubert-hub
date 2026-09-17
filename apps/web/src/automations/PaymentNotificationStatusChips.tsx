import { Chip } from '@mui/material';
import type { PaymentNotificationOutcomeStatus, PaymentNotificationProcessingStatus, PaymentNotificationResultStatus } from '../services/paymentNotifications';
import { executionStatusLabel, executionStatusSeverity, resultStatusLabels, resultStatusSeverity } from './paymentNotificationPresentation';

// Status is always conveyed by the label text (Pendiente/Completado/Parcial/Fallido/Sin resultado
// disponible, or Listo/Manual/Error/Omitido) — color is a restrained, secondary reinforcement
// only, never the sole signal (Phase 10C §23). processingStatus is required, not just
// outcomeStatus (PN1.2 production findings): a PENDIENTE execution and a PROCESADO-with-zero-
// results execution both carry a null outcomeStatus, but only the latter is "Sin resultado
// disponible" — the former must read "Pendiente" instead.
export function OutcomeStatusChip({ processingStatus, outcomeStatus }: { processingStatus: PaymentNotificationProcessingStatus; outcomeStatus: PaymentNotificationOutcomeStatus }) {
  const execution = { processingStatus, outcomeStatus };
  return <Chip label={executionStatusLabel(execution)} color={executionStatusSeverity(execution)} size="small" />;
}

export function ResultStatusChip({ status }: { status: PaymentNotificationResultStatus }) {
  return <Chip label={resultStatusLabels[status]} color={resultStatusSeverity(status)} size="small" />;
}
