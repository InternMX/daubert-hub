export type AutomationEnvironment = 'TEST' | 'PRODUCTION' | 'UNKNOWN';
export type AutomationIntegrationStatus = 'INTEGRATED' | 'NOT_INTEGRATED';
export type AutomationLifecycleStatus = 'ACTIVE' | 'INACTIVE' | null;
export type AutomationProcessingOutcome = 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'PROCESSING' | 'CANCELLED' | null;

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
}

export interface AutomationsOverviewResponse {
  data: AutomationOverview[];
}
