import { Injectable } from '@nestjs/common';
import { HealthService } from '../../health/health.service';
import { mapAudiExecutionState } from '../audi-processing-status';
import { PaymentNotificationsService } from '../payment-notifications/payment-notifications.service';
import { ReviewAcknowledgementsService, type AutomationReviewState } from '../review/review-acknowledgements.service';
import { AUTOMATION_CATALOG, pollingLabel, type AutomationCatalogEntry } from './automation-catalog';
import { AutomationsOverviewRepository, type AudiOverviewRow } from './automations-overview.repository';
import type { AutomationEnvironment, AutomationLifecycleStatus, AutomationOverview, AutomationReview, AutomationsOverviewResponse } from './automation-overview.types';

const NO_REVIEW_PROBLEM: AutomationReview = { required: false, problemOccurredAt: null, problemOutcome: null };

const AUDI_LIFECYCLE_MAP: Record<string, AutomationLifecycleStatus> = {
  ACTIVA: 'ACTIVE',
  INACTIVA: 'INACTIVE'
};

@Injectable()
export class AutomationsOverviewService {
  constructor(
    private readonly repository: AutomationsOverviewRepository,
    private readonly paymentNotifications: PaymentNotificationsService,
    private readonly health: HealthService,
    private readonly review: ReviewAcknowledgementsService
  ) {}

  // Every source is awaited together and none is caught individually: a genuine failure in any
  // one source fails the whole request (matching RecentActivityService's existing convention —
  // see recent-activity.service.ts) rather than silently presenting a healthy card built on
  // missing data (Phase 10E §12). Review state (Phase 10I) is fetched the same way: it is a
  // distinct read from lastProcessing, never derived from it.
  async getOverview(): Promise<AutomationsOverviewResponse> {
    const [health, audiRow, paymentList, audiReview, paymentReview] = await Promise.all([
      this.health.getHealth(),
      this.repository.findAudiOverview(),
      this.paymentNotifications.list({ page: 1, pageSize: 1 }),
      this.review.getReviewState('REMISIONES_AUDI'),
      this.review.getReviewState('PAYMENT_NOTIFICATIONS')
    ]);
    const environment = health.environment;
    const data = AUTOMATION_CATALOG.map((entry) => {
      if (entry.code === 'REMISIONES_AUDI') return this.mapAudi(entry, environment, audiRow, audiReview);
      if (entry.code === 'PAYMENT_NOTIFICATIONS') return this.mapPaymentNotifications(entry, environment, paymentList.data[0] ?? null, paymentReview);
      return this.mapCaterpillar(entry, environment);
    });
    return { data };
  }

  private base(entry: AutomationCatalogEntry, environment: AutomationEnvironment): Omit<AutomationOverview, 'lifecycleStatus' | 'lastCheckAt' | 'lastProcessing' | 'nextCheckAt' | 'review'> {
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

  private mapAudi(entry: AutomationCatalogEntry, environment: AutomationEnvironment, row: AudiOverviewRow | null, review: AutomationReviewState): AutomationOverview {
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
      nextCheckAt: null,
      review
    };
  }

  private mapPaymentNotifications(entry: AutomationCatalogEntry, environment: AutomationEnvironment, summary: Awaited<ReturnType<PaymentNotificationsService['list']>>['data'][number] | null, review: AutomationReviewState): AutomationOverview {
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
      nextCheckAt: null,
      review
    };
  }

  // Phase 12A.2: Caterpillar is IN_PREPARATION, not NOT_INTEGRATED (see automation-catalog.ts) —
  // but this task does not yet wire a repository query for it, so lifecycleStatus/lastCheckAt/
  // lastProcessing/nextCheckAt stay null here exactly as before (never fabricated, never a stand-in
  // for real PostgreSQL state). lifecycleStatus in particular must eventually come from
  // ops.automatizaciones.estatus independently of integrationStatus — null is "not wired up yet",
  // never a false ACTIVA/INACTIVA.
  private mapCaterpillar(entry: AutomationCatalogEntry, environment: AutomationEnvironment): AutomationOverview {
    return {
      ...this.base(entry, environment),
      lifecycleStatus: null,
      lastCheckAt: null,
      lastProcessing: null,
      nextCheckAt: null,
      // Never INTEGRATED: never generates a review acknowledgement (Phase 10I §2), and a healthy
      // review state is never fabricated for it either — same "no fabricated processing state"
      // rule as lastProcessing above.
      review: NO_REVIEW_PROBLEM
    };
  }
}
