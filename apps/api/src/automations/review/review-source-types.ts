// Single source of truth for ops.automation_review_acknowledgements.source_type values, shared by
// ReviewAcknowledgementsService (resolving/acknowledging the current problem) and the Audi/Payment
// Notifications list services (computing each row's frontend-facing reviewStatus) — never two
// independent copies of these literals (Phase 10I UX refinement).
export const AUDI_EXECUTION_SOURCE_TYPE = 'AUDI_EXECUTION';
export const PAYMENT_NOTIFICATION_EXECUTION_SOURCE_TYPE = 'PAYMENT_NOTIFICATION_EXECUTION';

// Phase 12A.4c: the explicit, single source of truth for which automation codes participate in
// the review-acknowledgement subsystem — deliberately NOT derived from
// AUTOMATION_CATALOG.integrationStatus. Those are independent concepts: integrationStatus says
// whether an automation is integrated into the Hub at all, while this says whether that
// automation's operational problems go through "Marcar como revisado". Caterpillar is the
// motivating case — fully INTEGRATED (Phase 12A.4b) with a real read-only dashboard, but it has
// no review-source-type constant above and no ReviewAcknowledgementsService.findProblem() branch,
// so it must stay out of this set. Add a code here only alongside an actual source-type constant
// and a real findProblem() branch for it — never automatically from catalog state.
export const REVIEW_SUPPORTED_AUTOMATION_CODES: ReadonlySet<string> = new Set([
  'REMISIONES_AUDI',
  'PAYMENT_NOTIFICATIONS'
]);
