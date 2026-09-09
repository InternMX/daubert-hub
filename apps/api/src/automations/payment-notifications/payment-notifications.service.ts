import { Injectable, NotFoundException } from '@nestjs/common';
import type { ListPaymentNotificationsDto } from './dto/list-payment-notifications.dto';
import { mapAttentionReason } from './payment-notification-reason';
import { derivePaymentNotificationOutcome, type PaymentNotificationOutcomeStatus, type PaymentNotificationProcessingStatus } from './payment-notification-status';
import { PaymentNotificationsRepository, type PaymentNotificationExecutionRow, type PaymentNotificationProviderResultRow } from './payment-notifications.repository';

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
  constructor(private readonly repository: PaymentNotificationsRepository) {}

  async list(input: ListPaymentNotificationsDto): Promise<ListPaymentNotificationsResponse> {
    const { total, executions } = await this.repository.list(input.page, input.pageSize);
    return {
      data: executions.map((execution) => this.mapSummary(execution)),
      meta: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) }
    };
  }

  async getDetail(executionId: string): Promise<PaymentNotificationExecutionDetailResponse> {
    const execution = await this.repository.findExecutionById(executionId);
    if (!execution) throw new NotFoundException('Ejecución de notificaciones de pago no encontrada.');
    const results = await this.repository.findResultsByExecutionId(executionId);
    return { data: { ...this.mapSummary(execution), results: results.map((result) => this.mapResult(result)) } };
  }

  private mapSummary(execution: PaymentNotificationExecutionRow): PaymentNotificationExecutionSummary {
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
      summarySentAt: execution.summary_sent_at ? new Date(execution.summary_sent_at).toISOString() : null
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
