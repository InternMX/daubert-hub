// Shared between the Payment Notifications dashboard (automations/payment-notifications)
// and Recent Activity (recent-activity/recent-activity.service.ts) so both surfaces derive
// the same business outcome from the same stored facts instead of each maintaining its own
// copy of this rule. Do not change this logic without checking both consumers' tests.
//
// core.resultados_notificacion_pago (LISTO/MANUAL/ERROR/OMITIDO, aggregated below as
// readyCount/manualCount/errorCount/omittedCount) is written by the production n8n workflow's
// "Registrar resultado LISTO/MANUAL/ERROR/OMITIDO" nodes, confirmed in PN1.2's correction pass.
// This module remains read-only over that table — it never writes it, and never invents retry
// semantics for it beyond the plain eligibility check in deriveReprocessAvailability below.

export type PaymentNotificationProcessingStatus = 'PENDIENTE' | 'PROCESADO' | 'ERROR';
export type PaymentNotificationOutcomeStatus = 'COMPLETED' | 'PARTIAL' | 'FAILED' | null;

export interface PaymentNotificationResultCounts {
  totalResults: number;
  readyCount: number;
  manualCount: number;
  errorCount: number;
  omittedCount: number;
}

// null means there is not enough provider-result information to derive a meaningful business
// outcome yet — still PENDIENTE, or PROCESADO with zero provider results. Never collapse that
// into COMPLETED just because the top-level state says PROCESADO (Phase 10A finding: 6 of 11
// TEST executions are PROCESADO with zero rows in core.resultados_notificacion_pago).
export function derivePaymentNotificationOutcome(processingStatus: PaymentNotificationProcessingStatus, counts: PaymentNotificationResultCounts): PaymentNotificationOutcomeStatus {
  if (processingStatus === 'PROCESADO') {
    if (counts.totalResults === 0) return null;
    return counts.manualCount > 0 || counts.errorCount > 0 ? 'PARTIAL' : 'COMPLETED';
  }
  if (processingStatus === 'ERROR') {
    const usefulCount = counts.readyCount + counts.manualCount + counts.omittedCount;
    return usefulCount > 0 ? 'PARTIAL' : 'FAILED';
  }
  return null;
}

// reprocessAvailable is a plain per-row fact derived from persisted state — deliberately NOT
// derived from outcomeStatus/reviewStatus themselves. It is its own independent predicate, so a
// future change to outcome labeling can never silently change reprocess eligibility. It mirrors
// the rule n8n applies when it picks a correo up for reprocess:
//   - estado='ERROR' (technical failures and alias/classification failures alike), OR
//   - estado='PROCESADO' and at least one of: a MANUAL or ERROR provider result (recoverable once
//     master data is corrected), an OMITIDO result whose company is CURRENTLY enabled
//     (procesa_comprobantes_pago AND notificaciones_activas — the omission may no longer apply),
//     or a pending HASH in detalle_error (a file n8n could not process yet).
// PENDIENTE is never reprocessable. LISTO results, and OMITIDO results of companies that are still
// disabled, never make a row reprocessable on their own. The Hub does not decide which results or
// files n8n will actually retry, and never changes the historical state of any result.
//
// The click-time check (PaymentNotificationsRepository.findReprocessableCorreoByExecutionId)
// re-evaluates the same rule in SQL against current data; keep the two in sync.
export interface PaymentNotificationReprocessSignals {
  // OMITIDO results whose company currently has procesa_comprobantes_pago AND notificaciones_activas.
  reactivatedOmittedCount: number;
  // detalle_error currently holds a HASH= token (same expression n8n uses).
  hasPendingFileHash: boolean;
}

export function deriveReprocessAvailability(processingStatus: PaymentNotificationProcessingStatus, counts: PaymentNotificationResultCounts, signals: PaymentNotificationReprocessSignals): boolean {
  if (processingStatus === 'ERROR') return true;
  if (processingStatus !== 'PROCESADO') return false;
  return counts.manualCount > 0 || counts.errorCount > 0 || signals.reactivatedOmittedCount > 0 || signals.hasPendingFileHash;
}
