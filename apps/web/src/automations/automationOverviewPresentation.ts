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

// Automation Center card operational accent (Phase 10I UX refinement §2). Deliberately restrained:
// no traffic-light circle, no green "healthy" state ever (silence already communicates health).
// RED beats WARNING — the two accents are never shown simultaneously, and Caterpillar
// (NOT_INTEGRATED) never gets a fabricated accent regardless of its (always-null) review/processing
// fields. Semantic MUI theme tokens only (error.main / warning.main) — see AutomationsPage.tsx.
export type AutomationHealthAccent = 'error' | 'warning' | null;

export function automationHealthAccent(automation: AutomationOverview): AutomationHealthAccent {
  if (automation.integrationStatus !== 'INTEGRATED') return null;
  if (automation.lastProcessing?.outcome === 'FAILED') return 'error';
  if (automation.review.required) return 'warning';
  return null;
}

export interface AutomationHealthText {
  text: string;
  color: 'error' | 'warning';
}

// Text always accompanies the accent color (never color-only signaling). Critical semantic point:
// acknowledged !== fixed — "Último procesamiento falló" is driven solely by lastProcessing.outcome
// and persists even once review.required has been acknowledged to false; only "Requiere revisión"
// is gated by review.required. Both may render together (e.g. a still-unacknowledged FAILED
// processing) even though the card accent itself stays RED-only.
export function automationHealthTexts(automation: AutomationOverview): AutomationHealthText[] {
  if (automation.integrationStatus !== 'INTEGRATED') return [];
  const texts: AutomationHealthText[] = [];
  if (automation.lastProcessing?.outcome === 'FAILED') texts.push({ text: 'Último procesamiento falló', color: 'error' });
  if (automation.review.required) texts.push({ text: 'Requiere revisión', color: 'warning' });
  return texts;
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
