import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';

export interface RemisionesAudiActivityRow extends QueryResultRow {
  execution_id: string;
  automation_name: string;
  execution_state: 'COMPLETADA' | 'ERROR' | 'CANCELADA';
  run_name: string | null;
  occurred_at: Date | string;
  error_node: string | null;
  error_message: string | null;
  generated_count: number;
  minimum_folio: string | null;
  maximum_folio: string | null;
}

@Injectable()
export class RemisionesAudiActivityRepository {
  constructor(private readonly database: DatabaseService) {}

  findRecent(limit: number): Promise<RemisionesAudiActivityRow[]> {
    return this.database.query<RemisionesAudiActivityRow>(`
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
        execution.ejecucion_id::text AS execution_id,
        automation.nombre AS automation_name,
        execution.estado AS execution_state,
        execution.run_name,
        COALESCE(execution.finalizada_en, execution.updated_at, execution.iniciada_en) AS occurred_at,
        execution.error_nodo AS error_node,
        execution.error_mensaje AS error_message,
        COALESCE(summary.generated_count, 0) AS generated_count,
        summary.minimum_folio::text AS minimum_folio,
        summary.maximum_folio::text AS maximum_folio
      FROM ops.ejecuciones_automatizacion execution
      JOIN ops.automatizaciones automation
        ON automation.automatizacion_id = execution.automatizacion_id
      LEFT JOIN remission_summary summary
        ON summary.ejecucion_id = execution.ejecucion_id
      WHERE automation.codigo = 'REMISIONES_AUDI'
        AND execution.estado IN ('COMPLETADA', 'ERROR', 'CANCELADA')
        AND execution.n8n_execution_id IS NOT NULL
      ORDER BY occurred_at DESC, execution.ejecucion_id DESC
      LIMIT $1`, [limit * 5]);
  }
}
