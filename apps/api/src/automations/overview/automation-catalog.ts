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
    integrationStatus: 'NOT_INTEGRATED',
    capabilities: { hasDashboard: false, hasHistory: false, hasDetail: false }
  }
] as const;

export function pollingLabel(intervalMinutes: number): string {
  return `Cada ${intervalMinutes} minutos`;
}
