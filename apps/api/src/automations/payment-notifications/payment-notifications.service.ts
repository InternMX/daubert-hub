import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuditIdentity } from '../../common/authenticated-request';
import { AutomationTriggerRequestsRepository } from '../trigger-requests/automation-trigger-requests.repository';
import { ReviewAcknowledgementsRepository } from '../review/review-acknowledgements.repository';
import { PAYMENT_NOTIFICATION_EXECUTION_SOURCE_TYPE } from '../review/review-source-types';
import type { ListPaymentNotificationsDto } from './dto/list-payment-notifications.dto';
import { parsePaymentNotificationFileErrors, type PaymentNotificationFileError } from './payment-notification-file-errors';
import { mapAttentionReason } from './payment-notification-reason';
import { derivePaymentNotificationOutcome, deriveReprocessAvailability, type PaymentNotificationOutcomeStatus, type PaymentNotificationProcessingStatus } from './payment-notification-status';
import { PaymentNotificationsRepository, type PaymentNotificationExecutionRow, type PaymentNotificationProviderResultRow } from './payment-notifications.repository';
import { PaymentNotificationsWebhookClient } from './payment-notifications-webhook.client';
import { AliasesService } from '../../aliases/aliases.service';
import type { PaymentAliasResolution } from '../../aliases/payment-alias-resolution';
import { PaymentFileAssignmentsService } from './payment-file-assignments.service';
import type { PaymentFileAssignmentDto } from './dto/payment-file-assignment.dto';
import type { PaymentFileAssignmentState } from './payment-file-assignments.repository';

const AUTOMATION_CODE = 'PAYMENT_NOTIFICATIONS';

export type PaymentNotificationReprocessResult =
  | { status: 'TRIGGERED' }
  | { status: 'NOT_FOUND' }
  | { status: 'NOT_ELIGIBLE' }
  | { status: 'UPSTREAM_ERROR' };

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
  // File-level errors (PDFs n8n could not associate with a company). A separate universe from the
  // per-company counts above: totalResults is NOT increased by fileErrors, and no per-company
  // result row is ever fabricated for them. The list carries only the count; the detail carries
  // fileErrorDetails.
  fileErrors: number;
  summarySent: boolean;
  summarySentAt: string | null;
  // Backend-authoritative, per-row (Phase 10I UX refinement §3/§4). Non-null on at most one row:
  // the row currently resolved as the outstanding problem by findLatestReviewWorthyExecution().
  // Every older PARTIAL/FAILED row is null — never independently actionable.
  reviewStatus: PaymentNotificationReviewStatus;
  // PN1.2 correction §3: a plain per-row fact computed from persisted state (correo.estado,
  // provider-result counts, currently-enabled OMITIDO results and pending file HASHes),
  // independently of outcomeStatus/reviewStatus — see deriveReprocessAvailability's comment for
  // why those must never be conflated. Unlike reviewStatus this is never limited to "at most one
  // row": any row with recoverable unresolved work reports true.
  reprocessAvailable: boolean;
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
  fileErrorDetails: Array<PaymentNotificationFileError & { aliasResolution: PaymentAliasResolution | null; fileAssignment: PaymentFileAssignmentState }>;
  fileAttentionSummary: { total: number; assignedPending: number; unassigned: number; pointPending: number };
}

export interface PaymentNotificationExecutionDetailResponse {
  data: PaymentNotificationExecutionDetail;
}

@Injectable()
export class PaymentNotificationsService {
  private readonly logger = new Logger(PaymentNotificationsService.name);

  // Phase 10I (Automation Review Acknowledgements): how many of the newest executions are
  // scanned (newest-first) looking for the latest PARTIAL/FAILED outcome. Generous enough that a
  // genuine outstanding problem is never missed by ordinary operational volume, while still
  // bounded — never an unlimited scan.
  private static readonly REVIEW_SCAN_LIMIT = 500;

  constructor(
    private readonly repository: PaymentNotificationsRepository,
    private readonly reviewAcknowledgements: ReviewAcknowledgementsRepository,
    private readonly webhookClient: PaymentNotificationsWebhookClient,
    private readonly triggerRequests: AutomationTriggerRequestsRepository,
    private readonly aliases: AliasesService,
    private readonly fileAssignments: PaymentFileAssignmentsService
  ) {}

  async list(input: ListPaymentNotificationsDto): Promise<ListPaymentNotificationsResponse> {
    const [{ total, executions }, currentProblem] = await Promise.all([
      this.repository.list(input.page, input.pageSize),
      this.findLatestReviewWorthyExecution()
    ]);
    const currentProblemStatus = currentProblem ? await this.resolveCurrentProblemStatus(currentProblem.executionId) : null;
    const pointBlocked = new Set(await this.fileAssignments.activeCorreoIds(executions.map((row) => row.execution_id)));
    return {
      data: executions.map((execution) => {
        const summary = this.mapSummary(execution, currentProblem?.executionId, currentProblemStatus);
        return { ...summary, reprocessAvailable: !pointBlocked.has(execution.execution_id) && summary.reprocessAvailable };
      }),
      meta: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) }
    };
  }

  async getDetail(executionId: string): Promise<PaymentNotificationExecutionDetailResponse> {
    const execution = await this.repository.findExecutionById(executionId);
    if (!execution) throw new NotFoundException('Ejecución de notificaciones de pago no encontrada.');
    const results = await this.repository.findResultsByExecutionId(executionId);
    const fileErrors = parsePaymentNotificationFileErrors(execution.file_error_detail);
    const detectableAliases = [...new Set(fileErrors.filter((file) => ['ALIAS_NO_CATALOGADO', 'ALIAS_AMBIGUO'].includes(file.errorCode) && file.detail).map((file) => file.detail!))];
    // Read current permanent assignments on EVERY detail request, using the same alias module
    // and n8n normalization as mutations. Historical error text and counts remain untouched.
    const resolutions = detectableAliases.length ? (await this.aliases.resolvePaymentAliases(detectableAliases)).data : [];
    const byAlias = new Map(resolutions.map((resolution) => [resolution.alias, resolution]));
    const points = await this.fileAssignments.describe(executionId, fileErrors);
    const pointBlocked = (await this.fileAssignments.activeCorreoIds([executionId])).length > 0;
    const files = fileErrors.map((file, index) => ({ ...file, aliasResolution: byAlias.get(file.detail ?? '') ?? null, fileAssignment: points[index]! }));
    const assignedPending = files.filter((file) => file.fileAssignment.assignment?.status === 'ACTIVA' || ['ACTIVE', 'NAME_ONLY'].includes(file.aliasResolution?.state ?? '')).length;
    const summary = this.mapSummary(execution);
    return {
      data: {
        ...summary,
        reprocessAvailable: !pointBlocked && summary.reprocessAvailable,
        results: results.map((result) => this.mapResult(result)),
        fileErrorDetails: files,
        fileAttentionSummary: { total: files.length, assignedPending, unassigned: files.length - assignedPending,
          pointPending: files.filter((file) => file.fileAssignment.assignment?.status === 'ACTIVA').length }
      }
    };
  }

  assignFile(executionId: string, fileId: string, input: PaymentFileAssignmentDto, requestId: string, identity: AuditIdentity) {
    return this.fileAssignments.mutate(executionId, fileId, input, requestId, identity);
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

  // PN1.2 targeting fix (§4): reprocess is a per-execution action — the caller passes the public
  // executionId for the exact row whose Reprocesar button was clicked, and this resolves that
  // execution's own internal correo_id, never any other row's. It never falls back to some other
  // globally-latest eligible correo (that was the bug: clicking row A could reprocess row B).
  //
  // PN1.2 correction §5/§6: the Hub never performs the underlying business-state transition
  // itself (ERROR -> PENDIENTE, or whatever n8n's reevaluation of a MANUAL/ERROR provider result
  // does) — that stays exclusively in n8n. This only resolves whether the requested email
  // currently has recoverable unresolved work and forwards its internal correo_id to n8n
  // server-to-server. correoId is never returned to the caller. No cross-process lock is
  // introduced here: n8n's own atomic state transition is the sole idempotency gate (see
  // PaymentNotificationsRepository.findReprocessableCorreoByExecutionId's comment).
  async reprocess(executionId: string, requestId: string, identity: AuditIdentity): Promise<PaymentNotificationReprocessResult> {
    this.assertIdentity(identity);
    const lookup = await this.repository.findReprocessableCorreoByExecutionId(executionId);
    if (lookup.status === 'NOT_FOUND') {
      await this.recordTriggerRequestSafely('NOTHING_TO_REPROCESS', requestId, identity);
      return { status: 'NOT_FOUND' };
    }
    if (lookup.status === 'NOT_ELIGIBLE') {
      await this.recordTriggerRequestSafely('NOTHING_TO_REPROCESS', requestId, identity);
      return { status: 'NOT_ELIGIBLE' };
    }

    return this.fileAssignments.protectReprocess(executionId, requestId, identity, async () => {
      const outcome = await this.webhookClient.triggerReprocess(lookup.correoId);
      const status = outcome === 'ACCEPTED' ? 'TRIGGERED' : 'UPSTREAM_ERROR';
      await this.recordTriggerRequestSafely(status, requestId, identity, lookup.correoId);
      return { status };
    });
  }

  private assertIdentity(identity: AuditIdentity): void {
    if (!identity.userEmail) throw new BadRequestException('No se pudo determinar el usuario autenticado.');
  }

  // PN1.2 correction §11: the audit row is written AFTER the webhook call has already resolved
  // (accepted or failed), so a failure writing it must never surface as if the reprocess request
  // itself failed — by the time we get here, n8n may already have accepted (and started acting
  // on) the request. Swallowing this write's own failure (logged, not thrown) is deliberately not
  // a distributed transaction: the audit row is best-effort history, never the business
  // idempotency gate (that's n8n's own atomic state transition), so there is nothing to roll back
  // and nothing unsafe about proceeding without it.
  //
  // actionType is always 'REPROCESS' here (PN1.2 final scope cleanup removed this module's RUN
  // action) — AutomationTriggerRequestsRepository/AutomationTriggerActionType still define 'RUN'
  // generically for a future automation module's own manual-run control.
  private async recordTriggerRequestSafely(
    outcome: 'TRIGGERED' | 'NOTHING_TO_REPROCESS' | 'UPSTREAM_ERROR',
    requestId: string,
    identity: AuditIdentity,
    targetReference: string | null = null
  ): Promise<void> {
    try {
      await this.triggerRequests.record(AUTOMATION_CODE, 'REPROCESS', outcome, requestId, identity, targetReference);
    } catch (error) {
      this.logger.error(`Failed to record automation trigger request audit row (actionType=REPROCESS, outcome=${outcome}, requestId=${requestId})`, error instanceof Error ? error.stack : error);
    }
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
      fileErrors: parsePaymentNotificationFileErrors(execution.file_error_detail).length,
      summarySent: execution.summary_sent,
      summarySentAt: execution.summary_sent_at ? new Date(execution.summary_sent_at).toISOString() : null,
      reviewStatus: currentProblemExecutionId && execution.execution_id === currentProblemExecutionId ? currentProblemStatus : null,
      reprocessAvailable: deriveReprocessAvailability(execution.processing_status, counts, {
        reactivatedOmittedCount: execution.reactivated_omitted_count,
        hasPendingFileHash: execution.has_pending_file_hash
      })
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
