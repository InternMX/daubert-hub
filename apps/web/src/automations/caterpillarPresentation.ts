import type { AutomationIntegrationStatus } from '../services/automationsOverview';
import { CaterpillarReprocessApiError, type CaterpillarReprocessResult, type CaterpillarStatus } from '../services/caterpillarRemissions';
import { lifecycleStatusLabel, processingOutcomeLabel, processingOutcomeSeverity, type ProcessingOutcomeSeverity } from './automationOverviewPresentation';

// Moved here from CaterpillarRemissionsPage.tsx (lint fix, no behavior change): that file exports
// the CaterpillarRemissionsPage component, and react-refresh/only-export-components requires a
// component file to export only components — a plain style-threshold constant living there broke
// Fast Refresh. This file already exports only non-components, so it's the correct home.
//
// Keep the operational columns visible in constrained desktop windows; route identifiers and
// series codes return once the viewport reaches the theme's full-desktop breakpoint.
export const wideOnlyProcessColumnSx = { display: { xs: 'none', lg: 'table-cell' } } as const;

// Reuses the automation-overview ACTIVE/INACTIVE -> Activa/Inactiva translation and the
// COMPLETED/FAILED/PROCESSING/CANCELLED outcome vocabulary (Phase 12A.4 §C/§D — same backend
// vocabulary as Audi, never a second copy of either translation). CaterpillarStatus never
// includes null, unlike AutomationLifecycleStatus, so the ! is safe here.
export function caterpillarStatusLabel(status: CaterpillarStatus): string {
  return lifecycleStatusLabel(status)!;
}

const INTEGRATION_STATUS_LABELS: Record<AutomationIntegrationStatus, string> = {
  INTEGRATED: 'Integrada',
  IN_PREPARATION: 'Integración en preparación',
  NOT_INTEGRATED: 'Sin integración'
};

// Phase 12A.4b: read live from automation.integrationStatus, never hard-coded — Caterpillar is
// INTEGRATED today (production-validated 2026-09-22), but IN_PREPARATION remains a real,
// supported lifecycle state for this same page if it were ever needed again (e.g. a rollback) or
// for a future automation, so this must stay data-driven rather than assuming one fixed value.
export function integrationStatusLabel(status: AutomationIntegrationStatus): string {
  return INTEGRATION_STATUS_LABELS[status];
}

// ACTIVE -> success (green), INACTIVE -> default (neutral gray) — same convention already used
// for the lifecycle chip on /automations (AutomationsPage.tsx). Deliberately never "error"/red for
// INACTIVE: many Caterpillar routes/series are intentionally prepared but disabled, not broken
// (Phase 12A.4 §C).
export function caterpillarStatusSeverity(status: CaterpillarStatus): 'success' | 'default' {
  return status === 'ACTIVE' ? 'success' : 'default';
}

export { processingOutcomeLabel as caterpillarOutcomeLabel, processingOutcomeSeverity as caterpillarOutcomeSeverity };
export type { ProcessingOutcomeSeverity as CaterpillarOutcomeSeverity };

const RESERVATION_STATUS_LABELS: Record<string, string> = {
  RESERVADA: 'Reservada',
  APLICADA: 'Aplicada',
  ABANDONADA: 'Abandonada'
};

// Falls back to the raw backend value for any status this map doesn't recognize yet — never
// drops or crashes, same "no fabricated translation" rule as caterpillarProcessLabel on the
// backend (Phase 12A.4 §B/§C: never invent labels for something not literally known).
export function reservationStatusLabel(status: string): string {
  return RESERVATION_STATUS_LABELS[status] ?? status;
}

const REMITTANCE_STATUS_LABELS: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  GENERADA: 'Generada',
  CANCELADA: 'Cancelada'
};

export function remittanceStatusLabel(status: string): string {
  return REMITTANCE_STATUS_LABELS[status] ?? status;
}

const PROCESS_UNDETERMINED_LABEL = 'Proceso no determinado';

// processLabel === null means the backend could not map the execution to exactly one route
// (e.g. Torreón/Torreón Planta 2 sharing one serie_id) — never inferred here from series code,
// source path, filename, or Dropbox folder (Phase 12A.4 §B). A known current model limitation,
// presented as such, never as an error.
export function caterpillarProcessLabelOrUndetermined(processLabel: string | null): string {
  return processLabel ?? PROCESS_UNDETERMINED_LABEL;
}

const timeZone = 'America/Mexico_City';

// documentDate/fecha_documento is a DATE-only value (no time-of-day) — formatted in UTC so the
// calendar day the database stored is never shifted by the viewer's local offset.
export function formatCaterpillarDate(value: string | null): string {
  if (!value) return 'No disponible';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'No disponible';
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(date).replace('.', '');
}

// startedAt/finishedAt are full timestamps (unlike documentDate) — local Mexico City time, with
// year, distinct from the compact card format used on /automations.
export function formatCaterpillarTimestamp(value: string | null): string {
  if (!value) return 'No disponible';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'No disponible';
  const datePart = new Intl.DateTimeFormat('es-MX', { timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(date).replace('.', '');
  const timePart = new Intl.DateTimeFormat('es-MX', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  return `${datePart} · ${timePart}`;
}

export function caterpillarFolioRangeLabel(minimumFolio: string | null, maximumFolio: string | null): string {
  if (!minimumFolio || !maximumFolio) return '—';
  return minimumFolio === maximumFolio ? minimumFolio : `${minimumFolio}–${maximumFolio}`;
}

// Phase 12C: a 202 does not always mean REPROCESS_CREATED — ALREADY_PROCESSING shares that same
// HTTP status, and ALREADY_REPROCESSED is a 200. The Hub's parsed `status` field (never the raw
// HTTP code) is the only thing this ever branches on. Neither ALREADY_PROCESSING nor
// ALREADY_REPROCESSED is ever presented as an error — both are legitimate, informative outcomes.
export function caterpillarReprocessSuccessMessage(result: CaterpillarReprocessResult): string {
  if (result.status === 'REPROCESS_CREATED') return `Reproceso iniciado correctamente. Nueva ejecución: #${result.executionId}`;
  if (result.status === 'ALREADY_PROCESSING') return 'El reproceso ya está en curso.';
  return `Esta ejecución ya fue reprocesada. Reproceso existente: #${result.executionId}`;
}

// 409 covers three genuinely different domain reasons (NOT_ELIGIBLE_STATE/SOURCE_FILE_MISSING/
// OUTSIDE_TEST_SCOPE) — the backend already produces a distinct, correctly-worded Spanish message
// for each (CaterpillarController.rejectIfError), so that message is shown directly rather than
// re-deriving it from the HTTP status alone, which cannot tell the three apart. Infrastructure
// failures (502/504) and anything else always use fixed, generic copy — never raw upstream/network
// detail, a stack trace, or any internal variable, regardless of what the backend's message says.
export function caterpillarReprocessErrorMessage(error: unknown): string {
  if (error instanceof CaterpillarReprocessApiError) {
    if (error.status === 404) return 'La ejecución ya no existe o no está disponible.';
    if (error.status === 409) return error.serverMessage ?? 'Esta ejecución ya no es elegible para reproceso.';
    if (error.status === 502) return 'No fue posible comunicarse correctamente con la automatización.';
    if (error.status === 504) return 'La automatización tardó demasiado en responder.';
  }
  return 'No fue posible solicitar el reproceso. Intenta nuevamente.';
}
