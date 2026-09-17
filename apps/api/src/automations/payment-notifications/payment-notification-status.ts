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

// PN1.2 correction: reprocessAvailable is a plain per-row fact derived from the underlying
// persisted business state (correo.estado plus the per-provider result counts already computed
// for outcome derivation) — deliberately NOT derived from outcomeStatus/reviewStatus themselves.
// It is its own independent predicate, sharing inputs with derivePaymentNotificationOutcome but
// not reusing its output, so a future change to outcome labeling can never silently change
// reprocess eligibility. True when there is recoverable unresolved work: the email itself is in
// estado='ERROR' (covers technical failures and alias/classification failures — n8n's
// "Marcar correo con error" sets estado='ERROR' for both), OR any provider result is MANUAL
// (recoverable once master data — alias, contacts, recipients — is corrected) OR ERROR. LISTO and
// OMITIDO results never make a row reprocessable on their own.
export function deriveReprocessAvailability(processingStatus: PaymentNotificationProcessingStatus, counts: PaymentNotificationResultCounts): boolean {
  return processingStatus === 'ERROR' || counts.manualCount > 0 || counts.errorCount > 0;
}
