import { Injectable } from '@nestjs/common';
import { mapAudiExecutionState, type AudiProcessingOutcome } from '../audi-processing-status';
import type { ListAudiExecutionsDto } from './dto/list-audi-executions.dto';
import { AudiExecutionsRepository, type AudiExecutionRow } from './audi-executions.repository';

export interface AudiProcessingSummary {
  occurredAt: string;
  outcome: AudiProcessingOutcome;
  generatedCount: number;
  firstFolio: string | null;
  lastFolio: string | null;
}

export interface ListAudiExecutionsResponse {
  data: AudiProcessingSummary[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

@Injectable()
export class AudiExecutionsService {
  constructor(private readonly repository: AudiExecutionsRepository) {}

  async list(input: ListAudiExecutionsDto): Promise<ListAudiExecutionsResponse> {
    const { total, executions } = await this.repository.list(input.page, input.pageSize);
    return {
      data: executions.map((execution) => this.mapSummary(execution)),
      meta: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) }
    };
  }

  private mapSummary(execution: AudiExecutionRow): AudiProcessingSummary {
    return {
      occurredAt: new Date(execution.occurred_at).toISOString(),
      // ejecuciones_automatizacion.estado is DB-CHECK-constrained to the four known values, so a
      // null here would mean the constraint itself changed — fail loudly rather than silently
      // fabricate an outcome.
      outcome: mapAudiExecutionState(execution.execution_state)!,
      generatedCount: execution.generated_count,
      firstFolio: execution.minimum_folio,
      lastFolio: execution.maximum_folio
    };
  }
}
