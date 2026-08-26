import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';

export interface PaymentNotificationActivityRow extends QueryResultRow {
  execution_state: 'PROCESADO' | 'ERROR';
  occurred_at: Date | string;
  result_count: number;
  ready_count: number;
  manual_count: number;
  error_count: number;
  omitted_count: number;
}

@Injectable()
export class PaymentNotificationActivityRepository {
  constructor(private readonly database: DatabaseService) {}

  async findRecent(limit: number): Promise<PaymentNotificationActivityRow[]> {
    return this.database.query<PaymentNotificationActivityRow>(`
      SELECT
        correo.estado AS execution_state,
        correo.fecha_procesado AS occurred_at,
        count(resultado.correo_id)::int AS result_count,
        count(*) FILTER (WHERE resultado.estado = 'LISTO')::int AS ready_count,
        count(*) FILTER (WHERE resultado.estado = 'MANUAL')::int AS manual_count,
        count(*) FILTER (WHERE resultado.estado = 'ERROR')::int AS error_count,
        count(*) FILTER (WHERE resultado.estado = 'OMITIDO')::int AS omitted_count
      FROM core.correos_notificacion_pago correo
      LEFT JOIN core.resultados_notificacion_pago resultado USING (correo_id)
      WHERE correo.estado = 'PROCESADO'
        AND correo.fecha_procesado IS NOT NULL
      GROUP BY correo.correo_id, correo.estado, correo.fecha_procesado
      HAVING count(resultado.correo_id) > 0
      ORDER BY correo.fecha_procesado DESC, correo.correo_id DESC
      LIMIT $1`, [limit * 5]);
  }
}
