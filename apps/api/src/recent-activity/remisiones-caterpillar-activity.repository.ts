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
      )
      SELECT
        execution.ejecucion_id::text AS execution_id,
        automation.nombre AS automation_name,
        execution.estado AS execution_state,
        COALESCE(execution.finalizada_en, execution.updated_at, execution.iniciada_en) AS occurred_at,
        document.nombre_archivo AS source_filename,
        resolved_route.process_key
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
      WHERE execution.estado IN ('COMPLETADA', 'PROCESANDO', 'ERROR', 'CANCELADA')
      ORDER BY occurred_at DESC, execution.ejecucion_id DESC
      LIMIT $1`, [limit * 5]);
  }
}
