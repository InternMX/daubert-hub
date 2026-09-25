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
  // Raw core.correos_notificacion_pago.detalle_error (same row, no extra query). Parsed into
  // structured file errors by the service (payment-notification-file-errors.ts), never in SQL.
  file_error_detail: string | null;
}

export interface ListedPaymentNotificationExecutions {
  total: number;
  executions: PaymentNotificationExecutionRow[];
}

export type ReprocessableCorreoLookup =
  | { status: 'FOUND'; correoId: string }
  | { status: 'NOT_FOUND' }
  | { status: 'NOT_ELIGIBLE' };

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
    count(*) FILTER (WHERE resultado.estado = 'OMITIDO')::int AS omitted_count,
    correo.detalle_error AS file_error_detail`;

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

  // Phase 10I (Automation Review Acknowledgements): newest-first, same correo_id ordering as
  // list(), bounded so a latest-review-worthy scan can never become an unbounded table scan.
  // Outcome derivation itself stays entirely in PaymentNotificationsService (derivePaymentNotificationOutcome)
  // — this method returns raw rows only, never re-implements the PARTIAL/FAILED rule in SQL.
  async listRecent(limit: number): Promise<PaymentNotificationExecutionRow[]> {
    return this.database.query<PaymentNotificationExecutionRow>(`
      SELECT ${EXECUTION_COLUMNS}
      FROM core.correos_notificacion_pago correo
      LEFT JOIN core.resultados_notificacion_pago resultado USING (correo_id)
      GROUP BY correo.correo_id
      ORDER BY correo.correo_id DESC
      LIMIT $1`, [limit]);
  }

  // PN1.2 targeting fix: resolves the internal correo_id for exactly the requested execution and
  // confirms it is currently eligible, instead of always picking the newest eligible row across
  // the whole table (the prior findLatestReprocessableCorreoId behavior let clicking Reprocesar
  // on an older eligible row silently reprocess a newer one). Same WHERE correo.correo_id =
  // $1::bigint scoping as findExecutionById below, and the same eligibility predicate as before:
  // the email itself is estado='ERROR' (covers technical failures and alias/classification
  // failures alike, per "Marcar correo con error"), OR it has at least one joined resultado in
  // estado MANUAL or ERROR. A PENDIENTE email is never eligible on either side. Intentionally NOT
  // wrapped in a locking SELECT ... FOR UPDATE transaction: the real reprocess idempotency/claim
  // gate lives entirely in n8n's own atomic state-transition guard for whichever eligibility path
  // applies to the targeted row, running on a separate connection entirely (PN1.2 §6). Deliberately
  // not describing that guard as one fixed SQL statement here — n8n's own reevaluation logic can
  // evolve independently of this predicate, and a hardcoded mechanism description would go stale.
  // Two concurrent Hub requests targeting the same executionId may both resolve it and both call
  // the webhook; n8n's own atomic state transition guarantees only one actual business retry
  // happens.
  async findReprocessableCorreoByExecutionId(executionId: string): Promise<ReprocessableCorreoLookup> {
    const [row] = await this.database.query<{ correo_id: string; eligible: boolean }>(`
      SELECT
        correo.correo_id::text AS correo_id,
        (correo.estado = 'ERROR' OR EXISTS (
              SELECT 1 FROM core.resultados_notificacion_pago resultado
              WHERE resultado.correo_id = correo.correo_id
                AND resultado.estado IN ('MANUAL', 'ERROR')
            )) AS eligible
      FROM core.correos_notificacion_pago correo
      WHERE correo.correo_id = $1::bigint`, [executionId]);
    if (!row) return { status: 'NOT_FOUND' };
    return row.eligible ? { status: 'FOUND', correoId: row.correo_id } : { status: 'NOT_ELIGIBLE' };
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
