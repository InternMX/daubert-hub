import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../../database/database.service';
import type { PaymentNotificationProcessingStatus } from './payment-notification-status';

export interface PaymentNotificationExecutionRow extends QueryResultRow {
  execution_id: string;
  created_at: Date | string;
  processed_at: Date | string | null;
  processing_status: PaymentNotificationProcessingStatus;
  summary_sent: boolean;
  summary_sent_at: Date | string | null;
  total_results: number;
  ready_count: number;
  manual_count: number;
  error_count: number;
  omitted_count: number;
}

export interface ListedPaymentNotificationExecutions {
  total: number;
  executions: PaymentNotificationExecutionRow[];
}

export interface PaymentNotificationProviderResultRow extends QueryResultRow {
  company_id: string;
  company_name: string | null;
  status: 'LISTO' | 'MANUAL' | 'ERROR' | 'OMITIDO';
  motivo: string | null;
}

// Deliberately NOT the Recent Activity aggregate query: that query's HAVING clause hides
// PROCESADO executions with zero provider results (see payment-notification-activity.repository.ts).
// The dashboard must show every execution (Phase 10B §3), so this selects all rows unconditionally.
const EXECUTION_COLUMNS = `
    correo.correo_id::text AS execution_id,
    correo.created_at,
    correo.fecha_procesado AS processed_at,
    correo.estado AS processing_status,
    correo.resumen_enviado AS summary_sent,
    correo.fecha_resumen_enviado AS summary_sent_at,
    count(resultado.correo_id)::int AS total_results,
    count(*) FILTER (WHERE resultado.estado = 'LISTO')::int AS ready_count,
    count(*) FILTER (WHERE resultado.estado = 'MANUAL')::int AS manual_count,
    count(*) FILTER (WHERE resultado.estado = 'ERROR')::int AS error_count,
    count(*) FILTER (WHERE resultado.estado = 'OMITIDO')::int AS omitted_count`;

@Injectable()
export class PaymentNotificationsRepository {
  constructor(private readonly database: DatabaseService) {}

  // Ordered by correo_id DESC: correo_id is a generated-always identity, so it is a stable,
  // always-populated, monotonically increasing proxy for execution recency. fecha_recepcion is
  // NULL on every row in the current TEST data (Phase 10A) and must not be relied on for ordering.
  async list(page: number, pageSize: number): Promise<ListedPaymentNotificationExecutions> {
    const [totalRow] = await this.database.query<{ total: number }>('SELECT count(*)::int AS total FROM core.correos_notificacion_pago');
    const executions = await this.database.query<PaymentNotificationExecutionRow>(`
      SELECT ${EXECUTION_COLUMNS}
      FROM core.correos_notificacion_pago correo
      LEFT JOIN core.resultados_notificacion_pago resultado USING (correo_id)
      GROUP BY correo.correo_id
      ORDER BY correo.correo_id DESC
      LIMIT $1 OFFSET $2`, [pageSize, (page - 1) * pageSize]);
    return { total: totalRow?.total ?? 0, executions };
  }

  async findExecutionById(executionId: string): Promise<PaymentNotificationExecutionRow | null> {
    const [execution] = await this.database.query<PaymentNotificationExecutionRow>(`
      SELECT ${EXECUTION_COLUMNS}
      FROM core.correos_notificacion_pago correo
      LEFT JOIN core.resultados_notificacion_pago resultado USING (correo_id)
      WHERE correo.correo_id = $1::bigint
      GROUP BY correo.correo_id`, [executionId]);
    return execution ?? null;
  }

  // LEFT JOIN core.empresas: a result row must remain visible even if the company name cannot
  // be resolved (Phase 10B §8) — company_name is simply null rather than the row being dropped.
  async findResultsByExecutionId(executionId: string): Promise<PaymentNotificationProviderResultRow[]> {
    return this.database.query<PaymentNotificationProviderResultRow>(`
      SELECT
        resultado.empresa_id::text AS company_id,
        empresa.nombre_comercial AS company_name,
        resultado.estado AS status,
        resultado.motivo
      FROM core.resultados_notificacion_pago resultado
      LEFT JOIN core.empresas empresa ON empresa.empresa_id = resultado.empresa_id
      WHERE resultado.correo_id = $1::bigint
      ORDER BY resultado.empresa_id`, [executionId]);
  }
}
