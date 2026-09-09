import { Injectable } from '@nestjs/common';
import { HealthService } from '../../health/health.service';
import { mapAudiExecutionState } from '../audi-processing-status';
import { PaymentNotificationsService } from '../payment-notifications/payment-notifications.service';
import { AUTOMATION_CATALOG, pollingLabel, type AutomationCatalogEntry } from './automation-catalog';
import { AutomationsOverviewRepository, type AudiOverviewRow } from './automations-overview.repository';
import type { AutomationEnvironment, AutomationLifecycleStatus, AutomationOverview, AutomationsOverviewResponse } from './automation-overview.types';

const AUDI_LIFECYCLE_MAP: Record<string, AutomationLifecycleStatus> = {
  ACTIVA: 'ACTIVE',
  INACTIVA: 'INACTIVE'
};

@Injectable()
export class AutomationsOverviewService {
  constructor(
    private readonly repository: AutomationsOverviewRepository,
    private readonly paymentNotifications: PaymentNotificationsService,
    private readonly health: HealthService
  ) {}

  // Every source is awaited together and none is caught individually: a genuine failure in any
  // one source fails the whole request (matching RecentActivityService's existing convention —
  // see recent-activity.service.ts) rather than silently presenting a healthy card built on
  // missing data (Phase 10E §12).
  async getOverview(): Promise<AutomationsOverviewResponse> {
    const [health, audiRow, paymentList] = await Promise.all([
      this.health.getHealth(),
      this.repository.findAudiOverview(),
      this.paymentNotifications.list({ page: 1, pageSize: 1 })
    ]);
    const environment = health.environment;
    const data = AUTOMATION_CATALOG.map((entry) => {
      if (entry.code === 'REMISIONES_AUDI') return this.mapAudi(entry, environment, audiRow);
      if (entry.code === 'PAYMENT_NOTIFICATIONS') return this.mapPaymentNotifications(entry, environment, paymentList.data[0] ?? null);
      return this.mapCaterpillar(entry, environment);
    });
    return { data };
  }

  private base(entry: AutomationCatalogEntry, environment: AutomationEnvironment): Omit<AutomationOverview, 'lifecycleStatus' | 'lastCheckAt' | 'lastProcessing' | 'nextCheckAt'> {
    return {
      code: entry.code,
      name: entry.name,
      description: entry.description,
      integrationStatus: entry.integrationStatus,
      environment,
      polling: { intervalMinutes: entry.pollingIntervalMinutes, label: pollingLabel(entry.pollingIntervalMinutes) },
      capabilities: entry.capabilities
    };
  }

  private mapAudi(entry: AutomationCatalogEntry, environment: AutomationEnvironment, row: AudiOverviewRow | null): AutomationOverview {
    const lifecycleStatus = row ? (AUDI_LIFECYCLE_MAP[row.lifecycle_status] ?? null) : null;
    const lastProcessing = row?.execution_state && row.occurred_at
      ? { occurredAt: new Date(row.occurred_at).toISOString(), outcome: mapAudiExecutionState(row.execution_state) }
      : null;
    return {
      ...this.base(entry, environment),
      lifecycleStatus,
      // ops.ejecuciones_automatizacion.documento_origen_id is NOT NULL (Phase 10E investigation):
      // a row only exists when a source document was found, so this table cannot represent a
      // no-work polling cycle. Última revisión is therefore never derivable from it.
      lastCheckAt: null,
      lastProcessing,
      nextCheckAt: null
    };
  }

  private mapPaymentNotifications(entry: AutomationCatalogEntry, environment: AutomationEnvironment, summary: Awaited<ReturnType<PaymentNotificationsService['list']>>['data'][number] | null): AutomationOverview {
    const lastProcessing = summary ? { occurredAt: summary.processedAt ?? summary.createdAt, outcome: summary.outcomeStatus } : null;
    return {
      ...this.base(entry, environment),
      lifecycleStatus: null,
      // core.correos_notificacion_pago.outlook_message_id is NOT NULL and unique (Phase 10E
      // investigation): a row only exists when an actual email was received, so this table
      // cannot represent a 5-minute polling cycle that found nothing. Última revisión is
      // therefore never derivable from it either.
      lastCheckAt: null,
      lastProcessing,
      nextCheckAt: null
    };
  }

  private mapCaterpillar(entry: AutomationCatalogEntry, environment: AutomationEnvironment): AutomationOverview {
    return {
      ...this.base(entry, environment),
      lifecycleStatus: null,
      lastCheckAt: null,
      lastProcessing: null,
      nextCheckAt: null
    };
  }
}
