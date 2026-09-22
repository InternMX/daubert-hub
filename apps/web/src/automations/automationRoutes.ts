// Single source of truth for which automation codes have a real Hub route today — shared by
// AutomationsPage.tsx (its "Ver automatización" card link, additionally gated there by the live
// capabilities.hasDashboard from GET /automations/overview) and AppShell.tsx's Automatizaciones
// sidebar submenu (consumed directly/unconditionally: the sidebar is primary navigation chrome
// present on every page, so it deliberately never depends on a runtime fetch the way the overview
// page itself does — that would make Audi/Notificaciones de pago's always-reliable sidebar links
// fail closed on a transient network error too, a worse regression than the one this fixes).
//
// Phase 12A.4d: this used to be a private constant duplicated as AppShell.tsx's hardcoded
// `automationSubmenu` array, with a second, entirely separate hardcoded "disabled — Sin
// integración" entry for Caterpillar that never updated once Caterpillar actually shipped a page
// (Phase 12A.4) and became INTEGRATED (Phase 12A.4b) — a classic two-independent-booleans drift.
// An entry belongs here only once its page genuinely exists and the automation is confirmed
// integrated — never added speculatively ahead of the real capability. Update this file, not a
// second copy, when that changes for any automation.
export const AUTOMATION_ROUTE_BY_CODE: Record<string, string> = {
  REMISIONES_AUDI: '/automations/remissions/audi',
  PAYMENT_NOTIFICATIONS: '/automations/payment-notifications',
  REMISIONES_CATERPILLAR: '/automations/remissions/caterpillar'
};
