// Shared between the Payment Notifications dashboard (automations/payment-notifications)
// and Recent Activity (recent-activity/recent-activity.service.ts) so both surfaces derive
// the same business outcome from the same stored facts instead of each maintaining its own
// copy of this rule. Do not change this logic without checking both consumers' tests.

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
