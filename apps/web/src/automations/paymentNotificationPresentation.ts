import type { PaymentNotificationOutcomeStatus, PaymentNotificationProcessingStatus, PaymentNotificationResultStatus } from '../services/paymentNotifications';

export const processingStatusLabels: Record<PaymentNotificationProcessingStatus, string> = {
  PENDIENTE: 'Pendiente',
  PROCESADO: 'Procesado',
  ERROR: 'Error de procesamiento'
};

const outcomeLabels: Record<Exclude<PaymentNotificationOutcomeStatus, null>, string> = {
  COMPLETED: 'Completado',
  PARTIAL: 'Parcial',
  FAILED: 'Fallido'
};

const NO_OUTCOME_LABEL = 'Sin resultado disponible';

// null (PENDIENTE, or PROCESADO with zero provider results — see Phase 10B) is never
// presented as Completado. It gets its own neutral label instead of guessing an outcome.
export function outcomeStatusLabel(outcome: PaymentNotificationOutcomeStatus): string {
  return outcome === null ? NO_OUTCOME_LABEL : outcomeLabels[outcome];
}

export type StatusSeverity = 'success' | 'warning' | 'error' | 'default';

export function outcomeStatusSeverity(outcome: PaymentNotificationOutcomeStatus): StatusSeverity {
  if (outcome === 'COMPLETED') return 'success';
  if (outcome === 'PARTIAL') return 'warning';
  if (outcome === 'FAILED') return 'error';
  return 'default';
}

interface ExecutionStatusInput {
  processingStatus: PaymentNotificationProcessingStatus;
  outcomeStatus: PaymentNotificationOutcomeStatus;
}

// PN1.2 production findings: PENDIENTE and "PROCESADO with zero results" both carry a null
// outcomeStatus from the backend, but they are not the same fact — PENDIENTE means the run has not
// finished yet, while a PROCESADO-with-zero-results row is a completed run that simply produced no
// per-provider results (a real, historical shape, not a bug to reinterpret). The primary status
// label must never collapse PENDIENTE into "Sin resultado disponible": that phrase only ever
// describes the second case. Once processing has produced an outcome (or PROCESADO is known to have
// zero results), outcomeStatusLabel/outcomeStatusSeverity already encode the right label/severity.
export function executionStatusLabel(execution: ExecutionStatusInput): string {
  if (execution.processingStatus === 'PENDIENTE') return processingStatusLabels.PENDIENTE;
  return outcomeStatusLabel(execution.outcomeStatus);
}

export function executionStatusSeverity(execution: ExecutionStatusInput): StatusSeverity {
  if (execution.processingStatus === 'PENDIENTE') return 'default';
  return outcomeStatusSeverity(execution.outcomeStatus);
}

export const resultStatusLabels: Record<PaymentNotificationResultStatus, string> = {
  LISTO: 'Listo',
  MANUAL: 'Manual',
  ERROR: 'Error',
  OMITIDO: 'Omitido'
};

export function resultStatusSeverity(status: PaymentNotificationResultStatus): StatusSeverity {
  if (status === 'LISTO') return 'success';
  if (status === 'MANUAL') return 'warning';
  if (status === 'ERROR') return 'error';
  return 'default';
}

export function resultCountsSummary(counts: { readyCount: number; manualCount: number; errorCount: number; omittedCount: number }): string {
  return `${counts.readyCount} Listos · ${counts.manualCount} Manual · ${counts.errorCount} Error · ${counts.omittedCount} Omitidos`;
}

// File-level errors are a separate universe from the per-company counts above (a PDF with no
// resolvable company has no empresa_id), so they are never folded into resultCountsSummary.
export function fileErrorsSummary(fileErrors: number): string {
  return `${fileErrors} ${fileErrors === 1 ? 'error de archivo' : 'errores de archivo'}`;
}

const timeZone = 'America/Mexico_City';

// processedAt wins when present; createdAt is the fallback (Phase 10B: fecha_recepcion is
// never part of the contract). Never renders "Invalid Date" — an unparsable/missing value
// falls back to a plain, explicit message instead.
export function executionTimestamp(execution: { processedAt: string | null; createdAt: string }): string {
  return formatTimestamp(execution.processedAt ?? execution.createdAt);
}

export function formatTimestamp(value: string | null): string {
  if (!value) return 'Fecha no disponible';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Fecha no disponible';
  const datePart = new Intl.DateTimeFormat('es-MX', { timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(date).replace('.', '');
  const timePart = new Intl.DateTimeFormat('es-MX', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  return `${datePart} · ${timePart}`;
}
