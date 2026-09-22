import type { AutomationIntegrationStatus } from './automation-overview.types';

// Stable process configuration confirmed by the project owner (Phase 10E) — never dynamic
// runtime state, and never written to the database merely to store it here (Phase 10E §5).
export interface AutomationCatalogEntry {
  code: 'REMISIONES_AUDI' | 'PAYMENT_NOTIFICATIONS' | 'REMISIONES_CATERPILLAR';
  name: string;
  description: string;
  pollingIntervalMinutes: number;
  integrationStatus: AutomationIntegrationStatus;
  capabilities: { hasDashboard: boolean; hasHistory: boolean; hasDetail: boolean };
}

export const AUTOMATION_CATALOG: readonly AutomationCatalogEntry[] = [
  {
    code: 'REMISIONES_AUDI',
    name: 'Remisiones Audi',
    description: 'Generación y control de remisiones.',
    pollingIntervalMinutes: 10,
    integrationStatus: 'INTEGRATED',
    capabilities: { hasDashboard: true, hasHistory: true, hasDetail: false }
  },
  {
    code: 'PAYMENT_NOTIFICATIONS',
    name: 'Notificaciones de pago',
    description: 'Revisa periódicamente nuevas notificaciones de pago.',
    pollingIntervalMinutes: 5,
    integrationStatus: 'INTEGRATED',
    capabilities: { hasDashboard: true, hasHistory: true, hasDetail: true }
  },
  {
    code: 'REMISIONES_CATERPILLAR',
    name: 'Remisiones Caterpillar',
    description: 'Generación y control de remisiones para Caterpillar.',
    pollingIntervalMinutes: 15,
    // Phase 12A.2: IN_PREPARATION while PostgreSQL PROD infrastructure and the PG candidate n8n
    // workflow existed but final operational validation was still pending.
    //
    // Phase 12A.4: capabilities flipped to true once the read-only Series/Executions/Detail
    // endpoints (Phase 12A.3) and the CaterpillarRemissionsPage (Phase 12A.4) actually existed —
    // capability flags describe whether the Hub surface exists, never whether the automation has
    // been operationally validated (that's integrationStatus's job).
    //
    // Phase 12A.4b: P5 and P6 completed real production validation on 2026-09-22 (initial
    // processing plus a second idempotent execution, both COMPLETADA) — INTEGRATED now. This is a
    // static, hand-confirmed catalog fact (Phase 10E §5), never derived from live execution rows;
    // it is NOT the same fact as ops.automatizaciones.estatus (still read independently — see
    // automations-overview.service.ts's mapCaterpillar) and must never be used to infer it.
    integrationStatus: 'INTEGRATED',
    capabilities: { hasDashboard: true, hasHistory: true, hasDetail: true }
  }
] as const;

export function pollingLabel(intervalMinutes: number): string {
  return `Cada ${intervalMinutes} minutos`;
}
