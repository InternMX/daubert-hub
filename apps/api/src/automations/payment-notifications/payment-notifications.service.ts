import { Injectable, NotFoundException } from '@nestjs/common';
import { ReviewAcknowledgementsRepository } from '../review/review-acknowledgements.repository';
import { PAYMENT_NOTIFICATION_EXECUTION_SOURCE_TYPE } from '../review/review-source-types';
import type { ListPaymentNotificationsDto } from './dto/list-payment-notifications.dto';
import { mapAttentionReason } from './payment-notification-reason';
import { derivePaymentNotificationOutcome, type PaymentNotificationOutcomeStatus, type PaymentNotificationProcessingStatus } from './payment-notification-status';
import { PaymentNotificationsRepository, type PaymentNotificationExecutionRow, type PaymentNotificationProviderResultRow } from './payment-notifications.repository';

export type PaymentNotificationReviewStatus = 'REQUIRED' | 'REVIEWED' | null;

export interface PaymentNotificationExecutionSummary {
  executionId: string;
  createdAt: string;
  processedAt: string | null;
  processingStatus: PaymentNotificationProcessingStatus;
  outcomeStatus: PaymentNotificationOutcomeStatus;
  totalResults: number;
  readyCount: number;
  manualCount: number;
  errorCount: number;
  omittedCount: number;
  summarySent: boolean;
  summarySentAt: string | null;
  // Backend-authoritative, per-row (Phase 10I UX refinement §3/§4). Non-null on at most one row:
  // the row currently resolved as the outstanding problem by findLatestReviewWorthyExecution().
  // Every older PARTIAL/FAILED row is null — never independently actionable.
  reviewStatus: PaymentNotificationReviewStatus;
}

export interface ListPaymentNotificationsResponse {
  data: PaymentNotificationExecutionSummary[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface PaymentNotificationProviderResult {
  companyId: string;
  companyName: string | null;
  status: 'LISTO' | 'MANUAL' | 'ERROR' | 'OMITIDO';
  attentionReason: string | null;
}

export interface PaymentNotificationExecutionDetail extends PaymentNotificationExecutionSummary {
  results: PaymentNotificationProviderResult[];
}

export interface PaymentNotificationExecutionDetailResponse {
  data: PaymentNotificationExecutionDetail;
}

@Injectable()
export class PaymentNotificationsService {
  // Phase 10I (Automation Review Acknowledgements): how many of the newest executions are
  // scanned (newest-first) looking for the latest PARTIAL/FAILED outcome. Generous enough that a
  // genuine outstanding problem is never missed by ordinary operational volume, while still
  // bounded — never an unlimited scan.
  private static readonly REVIEW_SCAN_LIMIT = 500;

  constructor(
    private readonly repository: PaymentNotificationsRepository,
    private readonly reviewAcknowledgements: ReviewAcknowledgementsRepository
  ) {}

  async list(input: ListPaymentNotificationsDto): Promise<ListPaymentNotificationsResponse> {
    const [{ total, executions }, currentProblem] = await Promise.all([
      this.repository.list(input.page, input.pageSize),
      this.findLatestReviewWorthyExecution()
    ]);
    const currentProblemStatus = currentProblem ? await this.resolveCurrentProblemStatus(currentProblem.executionId) : null;
    return {
      data: executions.map((execution) => this.mapSummary(execution, currentProblem?.executionId, currentProblemStatus)),
      meta: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) }
    };
  }

  async getDetail(executionId: string): Promise<PaymentNotificationExecutionDetailResponse> {
    const execution = await this.repository.findExecutionById(executionId);
    if (!execution) throw new NotFoundException('Ejecución de notificaciones de pago no encontrada.');
    const results = await this.repository.findResultsByExecutionId(executionId);
    return { data: { ...this.mapSummary(execution), results: results.map((result) => this.mapResult(result)) } };
  }

  // Reused by ReviewAcknowledgementsService (automations/review) instead of that module
  // re-deriving PARTIAL/FAILED itself — the only place outcome semantics live is
  // derivePaymentNotificationOutcome, via mapSummary below (Phase 10I §10).
  async findLatestReviewWorthyExecution(): Promise<PaymentNotificationExecutionSummary | null> {
    const executions = await this.repository.listRecent(PaymentNotificationsService.REVIEW_SCAN_LIMIT);
    for (const execution of executions) {
      const summary = this.mapSummary(execution);
      if (summary.outcomeStatus === 'PARTIAL' || summary.outcomeStatus === 'FAILED') return summary;
    }
    return null;
  }

  private async resolveCurrentProblemStatus(executionId: string): Promise<Exclude<PaymentNotificationReviewStatus, null>> {
    const acknowledgement = await this.reviewAcknowledgements.findLatest('PAYMENT_NOTIFICATIONS', PAYMENT_NOTIFICATION_EXECUTION_SOURCE_TYPE, executionId);
    return acknowledgement ? 'REVIEWED' : 'REQUIRED';
  }

  private mapSummary(execution: PaymentNotificationExecutionRow, currentProblemExecutionId?: string, currentProblemStatus: PaymentNotificationReviewStatus = null): PaymentNotificationExecutionSummary {
    const counts = {
      totalResults: execution.total_results,
      readyCount: execution.ready_count,
      manualCount: execution.manual_count,
      errorCount: execution.error_count,
      omittedCount: execution.omitted_count
    };
    return {
      executionId: execution.execution_id,
      createdAt: new Date(execution.created_at).toISOString(),
      processedAt: execution.processed_at ? new Date(execution.processed_at).toISOString() : null,
      processingStatus: execution.processing_status,
      outcomeStatus: derivePaymentNotificationOutcome(execution.processing_status, counts),
      ...counts,
      summarySent: execution.summary_sent,
      summarySentAt: execution.summary_sent_at ? new Date(execution.summary_sent_at).toISOString() : null,
      reviewStatus: currentProblemExecutionId && execution.execution_id === currentProblemExecutionId ? currentProblemStatus : null
    };
  }

  private mapResult(result: PaymentNotificationProviderResultRow): PaymentNotificationProviderResult {
    return {
      companyId: result.company_id,
      companyName: result.company_name,
      status: result.status,
      attentionReason: mapAttentionReason(result.motivo)
    };
  }
}
