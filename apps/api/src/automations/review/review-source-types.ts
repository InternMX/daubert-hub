// Single source of truth for ops.automation_review_acknowledgements.source_type values, shared by
// ReviewAcknowledgementsService (resolving/acknowledging the current problem) and the Audi/Payment
// Notifications list services (computing each row's frontend-facing reviewStatus) — never two
// independent copies of these literals (Phase 10I UX refinement).
export const AUDI_EXECUTION_SOURCE_TYPE = 'AUDI_EXECUTION';
export const PAYMENT_NOTIFICATION_EXECUTION_SOURCE_TYPE = 'PAYMENT_NOTIFICATION_EXECUTION';
