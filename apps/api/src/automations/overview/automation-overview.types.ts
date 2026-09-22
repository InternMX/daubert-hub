export type AutomationEnvironment = 'TEST' | 'PRODUCTION' | 'UNKNOWN';
// Product/integration lifecycle — distinct from ops.automatizaciones.estatus (ACTIVA/INACTIVA),
// which is the independent operational DB state surfaced separately as AutomationOverview.lifecycleStatus
// (Phase 12A.2). NOT_INTEGRATED: no usable Hub integration exists. IN_PREPARATION: Hub integration
// exists/is being exposed, but operational production validation/cutover is still pending — never
// implies the automation itself is ACTIVA. INTEGRATED: operationally validated and active/available.
export type AutomationIntegrationStatus = 'INTEGRATED' | 'IN_PREPARATION' | 'NOT_INTEGRATED';
export type AutomationLifecycleStatus = 'ACTIVE' | 'INACTIVE' | null;
export type AutomationProcessingOutcome = 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'PROCESSING' | 'CANCELLED' | null;
export type AutomationReviewOutcome = 'PARTIAL' | 'FAILED' | 'CANCELLED' | null;

// Human-review acknowledgement state (Phase 10I) — separate from lastProcessing. required=true
// while the latest review-worthy processing has no acknowledgement row yet, even if a later,
// unrelated processing succeeded (lastProcessing.outcome=COMPLETED, review.required=true is
// valid and intentional). The backend is authoritative here: never re-derive this in the
// frontend from lastProcessing alone.
export interface AutomationReview {
  required: boolean;
  problemOccurredAt: string | null;
  problemOutcome: AutomationReviewOutcome;
}

export interface AutomationOverview {
  code: string;
  name: string;
  description: string;
  integrationStatus: AutomationIntegrationStatus;
  environment: AutomationEnvironment;
  lifecycleStatus: AutomationLifecycleStatus;
  polling: { intervalMinutes: number; label: string };
  // Última revisión — a scheduled polling cycle regardless of whether work was found. null unless
  // the persistence genuinely records no-work cycles (Phase 10E investigation: it does not, for
  // either integrated automation today — see automations-overview.service.ts).
  lastCheckAt: string | null;
  // Último procesamiento — a polling cycle that found and executed real work.
  lastProcessing: { occurredAt: string; outcome: AutomationProcessingOutcome } | null;
  // Próxima revisión — never computed from intervalMinutes alone; null unless a real schedule
  // anchor or reliable last-check timestamp exists (it does not, today).
  nextCheckAt: string | null;
  capabilities: { hasDashboard: boolean; hasHistory: boolean; hasDetail: boolean };
  review: AutomationReview;
}

export interface AutomationsOverviewResponse {
  data: AutomationOverview[];
}
