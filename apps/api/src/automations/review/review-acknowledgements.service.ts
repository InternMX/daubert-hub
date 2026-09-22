import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuditIdentity } from '../../common/authenticated-request';
import { mapAudiExecutionState } from '../audi-processing-status';
import { AUTOMATION_CATALOG } from '../overview/automation-catalog';
import { PaymentNotificationsService } from '../payment-notifications/payment-notifications.service';
import { AudiExecutionsRepository } from '../remisiones-audi/audi-executions.repository';
import { ReviewAcknowledgementsRepository, type ReviewAcknowledgementRow } from './review-acknowledgements.repository';
import { AUDI_EXECUTION_SOURCE_TYPE, PAYMENT_NOTIFICATION_EXECUTION_SOURCE_TYPE, REVIEW_SUPPORTED_AUTOMATION_CODES } from './review-source-types';

// Kept intentionally close to AutomationProcessingOutcome (automation-overview.types.ts), but a
// review problem is never PROCESSING/COMPLETED/null-as-"no outcome" — only the outcomes that are
// actually review-worthy for at least one integrated automation.
export type ReviewProblemOutcome = 'PARTIAL' | 'FAILED' | 'CANCELLED' | null;

export interface AutomationReviewState {
  required: boolean;
  problemOccurredAt: string | null;
  problemOutcome: ReviewProblemOutcome;
}

export interface AcknowledgeReviewResponse {
  automationCode: string;
  reviewRequired: boolean;
  reviewedAt: string | null;
  reviewedBy: { displayName: string; email: string } | null;
}

type ReviewSourceType = 'AUDI_EXECUTION' | 'PAYMENT_NOTIFICATION_EXECUTION';

interface ReviewProblem {
  sourceType: ReviewSourceType;
  sourceReference: string;
  occurredAt: string;
  outcome: ReviewProblemOutcome;
}

// Phase 10I: the generic "has the current operational problem for this automation been
// reviewed?" mechanism. Deliberately narrow — see the phase spec's "do NOT implement" list
// (no pause/resume, no comments, no assignment, no reopening, no generic workflow engine).
//
// Review state is NEVER derived from lastProcessing alone. It is always: find the latest
// review-worthy processing, then check whether THAT SPECIFIC processing has an acknowledgement
// row. A later successful processing never clears an unacknowledged earlier problem, and
// acknowledging never modifies the underlying processing record.
@Injectable()
export class ReviewAcknowledgementsService {
  constructor(
    private readonly repository: ReviewAcknowledgementsRepository,
    private readonly audiExecutions: AudiExecutionsRepository,
    private readonly paymentNotifications: PaymentNotificationsService
  ) {}

  async getReviewState(automationCode: string): Promise<AutomationReviewState> {
    const problem = await this.findProblem(automationCode);
    if (!problem) return { required: false, problemOccurredAt: null, problemOutcome: null };
    const acknowledgement = await this.repository.findLatest(automationCode, problem.sourceType, problem.sourceReference);
    return { required: !acknowledgement, problemOccurredAt: problem.occurredAt, problemOutcome: problem.outcome };
  }

  // The browser never sends a source/incident ID (Phase 10I §11): the server always resolves the
  // current latest outstanding problem itself, so the frontend cannot manufacture an arbitrary
  // acknowledgement target.
  async acknowledge(automationCode: string, requestId: string, identity: AuditIdentity): Promise<AcknowledgeReviewResponse> {
    this.assertSupported(automationCode);
    if (!identity.userEmail) throw new BadRequestException('No se pudo determinar el usuario autenticado.');

    const problem = await this.findProblem(automationCode);
    if (!problem) {
      // Idempotent no-op: nothing outstanding to acknowledge right now.
      return { automationCode, reviewRequired: false, reviewedAt: null, reviewedBy: null };
    }

    const existing = await this.repository.findLatest(automationCode, problem.sourceType, problem.sourceReference);
    const row = existing ?? await this.repository.acknowledge(
      automationCode, problem.sourceType, problem.sourceReference, problem.occurredAt, requestId, identity
    );
    return this.mapAcknowledgeResponse(automationCode, row);
  }

  private async findProblem(automationCode: string): Promise<ReviewProblem | null> {
    if (automationCode === 'REMISIONES_AUDI') return this.findAudiProblem();
    if (automationCode === 'PAYMENT_NOTIFICATIONS') return this.findPaymentNotificationProblem();
    return null;
  }

  private async findAudiProblem(): Promise<ReviewProblem | null> {
    const row = await this.audiExecutions.findLatestProblem();
    if (!row) return null;
    const outcome = mapAudiExecutionState(row.execution_state);
    if (outcome !== 'FAILED' && outcome !== 'CANCELLED') return null;
    return {
      sourceType: AUDI_EXECUTION_SOURCE_TYPE,
      sourceReference: row.ejecucion_id,
      occurredAt: new Date(row.occurred_at).toISOString(),
      outcome
    };
  }

  private async findPaymentNotificationProblem(): Promise<ReviewProblem | null> {
    const summary = await this.paymentNotifications.findLatestReviewWorthyExecution();
    if (!summary) return null;
    return {
      sourceType: PAYMENT_NOTIFICATION_EXECUTION_SOURCE_TYPE,
      sourceReference: summary.executionId,
      occurredAt: summary.processedAt ?? summary.createdAt,
      outcome: summary.outcomeStatus as ReviewProblemOutcome
    };
  }

  // Phase 12A.4c: existence (404) and review support (400) are two separate questions.
  // Existence still comes from the catalog (an unknown code is a 404 regardless of review
  // support). Review support comes exclusively from REVIEW_SUPPORTED_AUTOMATION_CODES — never
  // from entry.integrationStatus, which answers a different question (Hub integration, not review
  // participation). An automation can be fully INTEGRATED and still not support review
  // (Caterpillar, Phase 12A.4b/12A.4c).
  private assertSupported(automationCode: string): void {
    const entry = AUTOMATION_CATALOG.find((item) => item.code === automationCode);
    if (!entry) throw new NotFoundException('Automatización no encontrada.');
    if (!REVIEW_SUPPORTED_AUTOMATION_CODES.has(automationCode)) {
      throw new BadRequestException('Esta automatización no admite revisión operativa.');
    }
  }

  // reviewed_by_email is the only actor label persisted (a historical snapshot, Phase 10I §4) —
  // there is no separate display-name column, so it is reused as displayName here rather than
  // adding a field the spec does not require.
  private mapAcknowledgeResponse(automationCode: string, row: ReviewAcknowledgementRow): AcknowledgeReviewResponse {
    return {
      automationCode,
      reviewRequired: false,
      reviewedAt: new Date(row.reviewed_at).toISOString(),
      reviewedBy: { displayName: row.reviewed_by_email, email: row.reviewed_by_email }
    };
  }
}
