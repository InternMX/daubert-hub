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
    // Phase 12A.2: PostgreSQL PROD infrastructure and the PG candidate n8n workflow exist, and Hub
    // monitoring is being integrated, but final operational validation with the first real
    // post-cutover file is still pending and the schedule is not yet enabled — IN_PREPARATION,
    // never NOT_INTEGRATED (a real Hub integration is in progress) and never INTEGRATED (not yet
    // operationally validated). Capabilities stay false until the Series/Executions/Detail
    // endpoints and page are actually implemented (Phase 12A.1 §12/§13) — this task only updates
    // the lifecycle status, not the capability flags.
    integrationStatus: 'IN_PREPARATION',
    capabilities: { hasDashboard: false, hasHistory: false, hasDetail: false }
  }
] as const;

export function pollingLabel(intervalMinutes: number): string {
  return `Cada ${intervalMinutes} minutos`;
}
