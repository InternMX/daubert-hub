import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../../database/database.service';

export interface AudiExecutionRow extends QueryResultRow {
  occurred_at: Date | string;
  execution_state: string;
  generated_count: number;
  minimum_folio: string | null;
  maximum_folio: string | null;
}

export interface ListedAudiExecutions {
  total: number;
  executions: AudiExecutionRow[];
}

// Deliberately its own query, not a reuse of RemisionesAudiActivityRepository (Recent Activity):
// that repository intentionally bounds itself to terminal states with a synced n8n_execution_id
// (correct for a bounded/mixed activity feed) — a dedicated Audi processing-history list must show
// every genuine execution for this automation instead, including PROCESANDO (Phase 10F §9/§13).
@Injectable()
export class AudiExecutionsRepository {
  constructor(private readonly database: DatabaseService) {}

  async list(page: number, pageSize: number): Promise<ListedAudiExecutions> {
    const [totalRow] = await this.database.query<{ total: number }>(`
      SELECT count(*)::int AS total
      FROM ops.ejecuciones_automatizacion execution
      JOIN ops.automatizaciones automation
        ON automation.automatizacion_id = execution.automatizacion_id
       AND automation.codigo = 'REMISIONES_AUDI'`);
    const executions = await this.database.query<AudiExecutionRow>(`
      WITH remission_summary AS (
        SELECT
          remission.ejecucion_id,
          count(*) FILTER (WHERE remission.estatus = 'GENERADA')::int AS generated_count,
          min(remission.folio) FILTER (WHERE remission.estatus = 'GENERADA') AS minimum_folio,
          max(remission.folio) FILTER (WHERE remission.estatus = 'GENERADA') AS maximum_folio
        FROM operacion.remisiones remission
        JOIN operacion.series_documentales series
          ON series.serie_id = remission.serie_id
         AND series.codigo = 'REMISION_AUDI'
        GROUP BY remission.ejecucion_id
      )
      SELECT
        COALESCE(execution.finalizada_en, execution.iniciada_en) AS occurred_at,
        execution.estado AS execution_state,
        COALESCE(summary.generated_count, 0) AS generated_count,
        summary.minimum_folio::text AS minimum_folio,
        summary.maximum_folio::text AS maximum_folio
      FROM ops.ejecuciones_automatizacion execution
      JOIN ops.automatizaciones automation
        ON automation.automatizacion_id = execution.automatizacion_id
       AND automation.codigo = 'REMISIONES_AUDI'
      LEFT JOIN remission_summary summary
        ON summary.ejecucion_id = execution.ejecucion_id
      ORDER BY execution.ejecucion_id DESC
      LIMIT $1 OFFSET $2`, [pageSize, (page - 1) * pageSize]);
    return { total: totalRow?.total ?? 0, executions };
  }
}
