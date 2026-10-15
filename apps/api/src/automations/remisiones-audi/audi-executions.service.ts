import { Injectable, NotFoundException } from '@nestjs/common';
import { mapAudiExecutionState, type AudiProcessingOutcome } from '../audi-processing-status';
import { ReviewAcknowledgementsRepository } from '../review/review-acknowledgements.repository';
import { AUDI_EXECUTION_SOURCE_TYPE } from '../review/review-source-types';
import type { ListAudiExecutionsDto } from './dto/list-audi-executions.dto';
import { AudiExecutionsRepository, type AudiExecutionRow } from './audi-executions.repository';
import { audiDiagnostic, audiSourceFilename } from './audi-detail-presentation';

export type AudiExecutionReviewStatus = 'REQUIRED' | 'REVIEWED' | null;

export interface AudiProcessingSummary {
  executionId: string;
  occurredAt: string;
  outcome: AudiProcessingOutcome;
  generatedCount: number;
  firstFolio: string | null;
  lastFolio: string | null;
  // Backend-authoritative, per-row (Phase 10I UX refinement §3/§4). Non-null on at most one row:
  // the row currently resolved as the outstanding problem by
  // ReviewAcknowledgementsService/AudiExecutionsRepository.findLatestProblem(). Every older
  // FAILED/CANCELLED row is null — never independently actionable. Never derive this on the
  // frontend by comparing outcomes; it is computed here from the same "latest problem" identity
  // used by the acknowledge endpoint.
  reviewStatus: AudiExecutionReviewStatus;
}

export interface ListAudiExecutionsResponse {
  data: AudiProcessingSummary[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface AudiExecutionDetail {
  executionId: string;
  outcome: AudiProcessingOutcome;
  startedAt: string;
  finishedAt: string | null;
  generatedCount: number;
  sourceDocument: { documentId: string; filename: string | null } | null;
  latestErrorMessage: string | null;
  remittances: { remissionId: string; seriesCode: string; folio: string; documentDate: string; status: string }[];
}

export interface AudiExecutionDetailResponse { data: AudiExecutionDetail }

@Injectable()
export class AudiExecutionsService {
  constructor(
    private readonly repository: AudiExecutionsRepository,
    private readonly reviewAcknowledgements: ReviewAcknowledgementsRepository
  ) {}

  async getDetail(executionId: string): Promise<AudiExecutionDetailResponse> {
    const execution = await this.repository.findById(executionId);
    if (!execution) throw new NotFoundException('Ejecución de Audi no encontrada.');
    const remissions = await this.repository.findRemissionsByExecutionId(executionId);
    return { data: {
      executionId: execution.ejecucion_id,
      outcome: mapAudiExecutionState(execution.execution_state)!,
      startedAt: new Date(execution.started_at).toISOString(),
      finishedAt: execution.finished_at ? new Date(execution.finished_at).toISOString() : null,
      generatedCount: remissions.filter((remission) => remission.estatus === 'GENERADA').length,
      sourceDocument: execution.documento_id ? { documentId: execution.documento_id, filename: audiSourceFilename(execution.source_filename) } : null,
      latestErrorMessage: audiDiagnostic(execution.error_message),
      remittances: remissions.map((remission) => ({
        remissionId: remission.remision_id, seriesCode: remission.serie_codigo,
        folio: remission.folio, documentDate: remission.document_date, status: remission.estatus
      }))
    } };
  }

  async list(input: ListAudiExecutionsDto): Promise<ListAudiExecutionsResponse> {
    const [{ total, executions }, currentProblem] = await Promise.all([
      this.repository.list(input.page, input.pageSize),
      this.repository.findLatestProblem()
    ]);
    const currentProblemStatus = currentProblem ? await this.resolveCurrentProblemStatus(currentProblem.ejecucion_id) : null;
    return {
      data: executions.map((execution) => this.mapSummary(execution, currentProblem?.ejecucion_id, currentProblemStatus)),
      meta: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) }
    };
  }

  private async resolveCurrentProblemStatus(ejecucionId: string): Promise<Exclude<AudiExecutionReviewStatus, null>> {
    const acknowledgement = await this.reviewAcknowledgements.findLatest('REMISIONES_AUDI', AUDI_EXECUTION_SOURCE_TYPE, ejecucionId);
    return acknowledgement ? 'REVIEWED' : 'REQUIRED';
  }

  private mapSummary(execution: AudiExecutionRow, currentProblemEjecucionId: string | undefined, currentProblemStatus: AudiExecutionReviewStatus): AudiProcessingSummary {
    return {
      executionId: execution.ejecucion_id,
      occurredAt: new Date(execution.occurred_at).toISOString(),
      // ejecuciones_automatizacion.estado is DB-CHECK-constrained to the four known values, so a
      // null here would mean the constraint itself changed — fail loudly rather than silently
      // fabricate an outcome.
      outcome: mapAudiExecutionState(execution.execution_state)!,
      generatedCount: execution.generated_count,
      firstFolio: execution.minimum_folio,
      lastFolio: execution.maximum_folio,
      reviewStatus: currentProblemEjecucionId && execution.ejecucion_id === currentProblemEjecucionId ? currentProblemStatus : null
    };
  }
}
