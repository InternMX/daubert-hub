import type { AutomationLifecycleStatus, AutomationOverview, AutomationProcessingOutcome } from '../services/automationsOverview';

export function lifecycleStatusLabel(status: AutomationLifecycleStatus): string | null {
  if (status === 'ACTIVE') return 'Activa';
  if (status === 'INACTIVE') return 'Inactiva';
  return null;
}

const outcomeLabels: Record<Exclude<AutomationProcessingOutcome, null>, string> = {
  COMPLETED: 'Completado',
  PARTIAL: 'Parcial',
  FAILED: 'Fallido',
  PROCESSING: 'En proceso',
  CANCELLED: 'Cancelado'
};

// null means a processing event exists but its outcome could not be derived (e.g. a Payment
// Notifications execution with zero provider results) — never presented as a fabricated success.
export function processingOutcomeLabel(outcome: AutomationProcessingOutcome): string {
  return outcome === null ? 'Sin resultado disponible' : outcomeLabels[outcome];
}

export type ProcessingOutcomeSeverity = 'success' | 'warning' | 'error' | 'default';

// Shared severity mapping (Phase 10F §13): the general /automations panel and the Remisiones
// Audi dashboard must never diverge on what a given outcome visually means. Status is always
// conveyed by the label text (processingOutcomeLabel) — color here is reinforcement only.
export function processingOutcomeSeverity(outcome: AutomationProcessingOutcome): ProcessingOutcomeSeverity {
  if (outcome === 'COMPLETED') return 'success';
  if (outcome === 'PARTIAL' || outcome === 'CANCELLED') return 'warning';
  if (outcome === 'FAILED') return 'error';
  return 'default';
}

// Requiere revisión (Phase 10F §3): only an INTEGRATED automation's most recent processing
// outcome can honestly justify a review prompt. PARTIAL/FAILED/CANCELLED are all shapes of "the
// business process did not simply succeed"; PROCESSING is still in flight (not enough evidence
// yet) and null means insufficient information — neither counts. A NOT_INTEGRATED automation
// already has its own "Sin integración" metric and must never double-count here.
export function requiresReview(automation: AutomationOverview): boolean {
  if (automation.integrationStatus !== 'INTEGRATED') return false;
  const outcome = automation.lastProcessing?.outcome;
  return outcome === 'PARTIAL' || outcome === 'FAILED' || outcome === 'CANCELLED';
}

const timeZone = 'America/Mexico_City';

// Compact card timestamp (no year — see the confirmed Phase 10E card mockups), distinct from the
// full-detail timestamp already used by the individual Payment Notifications dashboard pages.
export function formatCardTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Fecha no disponible';
  const datePart = new Intl.DateTimeFormat('es-MX', { timeZone, day: 'numeric', month: 'short' }).format(date).replace('.', '');
  const timePart = new Intl.DateTimeFormat('es-MX', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  return `${datePart} · ${timePart}`;
}
