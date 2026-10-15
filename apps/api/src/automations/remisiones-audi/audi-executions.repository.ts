import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../../database/database.service';

export interface AudiExecutionRow extends QueryResultRow {
  // Keep bigint identities as strings, including when matching review acknowledgements.
  ejecucion_id: string;
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

export interface AudiProblemRow extends QueryResultRow {
  ejecucion_id: string;
  occurred_at: Date | string;
  execution_state: string;
}

export interface AudiExecutionDetailRow extends QueryResultRow {
  ejecucion_id: string;
  execution_state: string;
  started_at: Date | string;
  finished_at: Date | string | null;
  error_message: string | null;
  documento_id: string | null;
  source_filename: string | null;
}

export interface AudiRemissionRow extends QueryResultRow {
  remision_id: string;
  serie_codigo: string;
  folio: string;
  document_date: string;
  estatus: string;
}

// Deliberately its own query, not a reuse of RemisionesAudiActivityRepository (Recent Activity):
// that repository intentionally bounds itself to terminal states with a synced n8n_execution_id
// (correct for a bounded/mixed activity feed) — a dedicated Audi processing-history list must show
// every genuine execution for this automation instead, including PROCESANDO (Phase 10F §9/§13).
@Injectable()
export class AudiExecutionsRepository {
  constructor(private readonly database: DatabaseService) {}

  async findById(executionId: string): Promise<AudiExecutionDetailRow | null> {
    const [row] = await this.database.query<AudiExecutionDetailRow>(`
      SELECT execution.ejecucion_id::text AS ejecucion_id,
        execution.estado AS execution_state,
        execution.iniciada_en AS started_at,
        execution.finalizada_en AS finished_at,
        execution.error_mensaje AS error_message,
        document.documento_id::text AS documento_id,
        document.nombre_archivo AS source_filename
      FROM ops.ejecuciones_automatizacion execution
      JOIN ops.automatizaciones automation
        ON automation.automatizacion_id = execution.automatizacion_id
       AND automation.codigo = 'REMISIONES_AUDI'
      LEFT JOIN core.documentos document ON document.documento_id = execution.documento_origen_id
      WHERE execution.ejecucion_id = $1::bigint`, [executionId]);
    return row ?? null;
  }

  // Historical folios come from persisted remissions, not the allocator or current counter.
  // No dependency on reservas_folios or remision_detalle, including for empty executions.
  async findRemissionsByExecutionId(executionId: string): Promise<AudiRemissionRow[]> {
    return this.database.query<AudiRemissionRow>(`
      SELECT remission.remision_id::text AS remision_id, series.codigo AS serie_codigo,
        remission.folio::text AS folio, remission.fecha_documento::text AS document_date,
        remission.estatus
      FROM operacion.remisiones remission
      JOIN operacion.series_documentales series
        ON series.serie_id = remission.serie_id AND series.codigo = 'REMISION_AUDI'
      JOIN ops.ejecuciones_automatizacion execution ON execution.ejecucion_id = remission.ejecucion_id
      JOIN ops.automatizaciones automation
        ON automation.automatizacion_id = execution.automatizacion_id
       AND automation.codigo = 'REMISIONES_AUDI'
      WHERE remission.ejecucion_id = $1::bigint
      ORDER BY remission.folio, remission.remision_id`, [executionId]);
  }

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
        execution.ejecucion_id::text AS ejecucion_id,
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

  // Phase 10I (Automation Review Acknowledgements): the latest ERROR/CANCELADA execution for
  // REMISIONES_AUDI, ordered by ejecucion_id (monotonic identity), never by a nullable timestamp
  // alone. estado is filtered in SQL rather than scanning every row through
  // mapAudiExecutionState, but the two states selected here (ERROR, CANCELADA) are exactly the
  // ones that map to a review-worthy outcome (FAILED, CANCELLED) — see audi-processing-status.ts.
  async findLatestProblem(): Promise<AudiProblemRow | null> {
    const [row] = await this.database.query<AudiProblemRow>(`
      SELECT
        execution.ejecucion_id::text AS ejecucion_id,
        COALESCE(execution.finalizada_en, execution.iniciada_en) AS occurred_at,
        execution.estado AS execution_state
      FROM ops.ejecuciones_automatizacion execution
      JOIN ops.automatizaciones automation
        ON automation.automatizacion_id = execution.automatizacion_id
       AND automation.codigo = 'REMISIONES_AUDI'
      WHERE execution.estado IN ('ERROR', 'CANCELADA')
      ORDER BY execution.ejecucion_id DESC
      LIMIT 1`);
    return row ?? null;
  }
}
