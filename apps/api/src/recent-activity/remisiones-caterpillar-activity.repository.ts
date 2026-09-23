import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';

export interface RemisionesCaterpillarActivityRow extends QueryResultRow {
  execution_id: string;
  automation_name: string;
  execution_state: 'COMPLETADA' | 'PROCESANDO' | 'ERROR' | 'CANCELADA';
  occurred_at: Date | string;
  source_filename: string;
  process_key: string | null;
  generated_count: number;
  minimum_folio: string | null;
  maximum_folio: string | null;
}

@Injectable()
export class RemisionesCaterpillarActivityRepository {
  constructor(private readonly database: DatabaseService) {}

  findRecent(limit: number): Promise<RemisionesCaterpillarActivityRow[]> {
    return this.database.query<RemisionesCaterpillarActivityRow>(`
      WITH reservation_series AS (
        SELECT
          reservation.ejecucion_id,
          array_agg(DISTINCT reservation.serie_id) AS series_ids
        FROM operacion.reservas_folios reservation
        GROUP BY reservation.ejecucion_id
      ),
      remission_summary AS (
        SELECT
          remission.ejecucion_id,
          count(*) FILTER (WHERE remission.estatus = 'GENERADA')::int AS generated_count,
          min(remission.folio) FILTER (WHERE remission.estatus = 'GENERADA') AS minimum_folio,
          max(remission.folio) FILTER (WHERE remission.estatus = 'GENERADA') AS maximum_folio
        FROM operacion.remisiones remission
        GROUP BY remission.ejecucion_id
      )
      SELECT
        execution.ejecucion_id::text AS execution_id,
        automation.nombre AS automation_name,
        execution.estado AS execution_state,
        COALESCE(execution.finalizada_en, execution.updated_at, execution.iniciada_en) AS occurred_at,
        document.nombre_archivo AS source_filename,
        resolved_route.process_key,
        COALESCE(summary.generated_count, 0) AS generated_count,
        summary.minimum_folio::text AS minimum_folio,
        summary.maximum_folio::text AS maximum_folio
      FROM ops.ejecuciones_automatizacion execution
      JOIN ops.automatizaciones automation
        ON automation.automatizacion_id = execution.automatizacion_id
       AND automation.codigo = 'REMISIONES_CATERPILLAR'
      JOIN core.documentos document
        ON document.documento_id = execution.documento_origen_id
      LEFT JOIN reservation_series reservation
        ON reservation.ejecucion_id = execution.ejecucion_id
      LEFT JOIN LATERAL (
        SELECT CASE WHEN count(*) = 1 THEN min(route.llave_proceso) END AS process_key
        FROM ops.automatizacion_series_proceso route
        WHERE route.automatizacion_id = automation.automatizacion_id
          AND cardinality(reservation.series_ids) = 1
          AND route.serie_id = reservation.series_ids[1]
      ) resolved_route ON true
      -- remission_summary is grouped on the raw table with no automation filter of its own (never
      -- parsing operacion.series_documentales.codigo, per Phase 12A.3 §B) — safe because it is only
      -- ever joined by ejecucion_id against the already REMISIONES_CATERPILLAR-scoped execution rows
      -- above, mirroring CaterpillarExecutionsRepository.list().
      LEFT JOIN remission_summary summary
        ON summary.ejecucion_id = execution.ejecucion_id
      WHERE execution.estado IN ('COMPLETADA', 'PROCESANDO', 'ERROR', 'CANCELADA')
      ORDER BY occurred_at DESC, execution.ejecucion_id DESC
      LIMIT $1`, [limit * 5]);
  }
}
