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
  // Internal inputs to deriveReprocessAvailability only — never part of the public summary.
  // reactivated_omitted_count: OMITIDO results whose company is CURRENTLY enabled (see
  // OMITTED_COMPANY_ENABLED_SQL). has_pending_file_hash: detalle_error holds a HASH= token (see
  // PENDING_FILE_HASH_SQL).
  reactivated_omitted_count: number;
  has_pending_file_hash: boolean;
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

// Shared SQL fragments so the list (aggregate counts feeding deriveReprocessAvailability) and the
// click-time check (findReprocessableCorreoByExecutionId) evaluate the exact same conditions. Both
// use the aliases `correo`, `resultado` and `np` (core.empresas_notificacion_pago).
//
// np is joined 1:1 on its primary key (empresa_id), so joining it never multiplies result rows. A
// company with no configuration row has NULL flags, and `IS TRUE` makes that NOT enabled.
const OMITTED_COMPANY_ENABLED_SQL = `resultado.estado = 'OMITIDO'
        AND np.procesa_comprobantes_pago IS TRUE
        AND np.notificaciones_activas IS TRUE`;
const MANUAL_OR_ERROR_RESULT_SQL = `resultado.estado IN ('MANUAL', 'ERROR')`;
// Same expression n8n uses to find files to retry. A HASH stays pending while it is present in
// detalle_error (n8n clears detalle_error when it picks the correo up for reprocess); the Hub does
// not try to know whether the file will end up resolved.
const PENDING_FILE_HASH_SQL = `COALESCE(correo.detalle_error ~ 'HASH=[0-9A-Fa-f]{64}', FALSE)`;

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
    correo.detalle_error AS file_error_detail,
    (count(*) FILTER (WHERE ${OMITTED_COMPANY_ENABLED_SQL}))::int AS reactivated_omitted_count,
    ${PENDING_FILE_HASH_SQL} AS has_pending_file_hash`;

// Shared FROM/JOIN for every EXECUTION_COLUMNS query. np only feeds reactivated_omitted_count.
const EXECUTION_FROM = `FROM core.correos_notificacion_pago correo
      LEFT JOIN core.resultados_notificacion_pago resultado USING (correo_id)
      LEFT JOIN core.empresas_notificacion_pago np ON np.empresa_id = resultado.empresa_id`;

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
      ${EXECUTION_FROM}
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
      ${EXECUTION_FROM}
      GROUP BY correo.correo_id
      ORDER BY correo.correo_id DESC
      LIMIT $1`, [limit]);
  }

  // PN1.2 targeting fix: resolves the internal correo_id for exactly the requested execution and
  // confirms it is currently eligible, instead of always picking the newest eligible row across
  // the whole table. Same WHERE correo.correo_id = $1::bigint scoping as findExecutionById below.
  //
  // Eligibility mirrors deriveReprocessAvailability and is re-evaluated here against current
  // PostgreSQL data (including the company's CURRENT configuration), never trusting what the list
  // showed earlier: the correo is estado='ERROR', OR it is PROCESADO and has a MANUAL/ERROR
  // result, an OMITIDO result whose company is currently enabled, or a pending HASH in
  // detalle_error. PENDIENTE is never eligible. The fragments are the same ones EXECUTION_COLUMNS
  // uses, so list and click cannot drift apart.
  //
  // Intentionally NOT wrapped in a locking SELECT ... FOR UPDATE transaction: the real reprocess
  // idempotency/claim gate lives entirely in n8n's own atomic state-transition guard, running on a
  // separate connection (PN1.2 §6). Two concurrent Hub requests targeting the same executionId may
  // both resolve it and both call the webhook; n8n guarantees only one actual business retry
  // happens. Read-only: nothing here ever writes core.resultados_notificacion_pago.
  async findReprocessableCorreoByExecutionId(executionId: string): Promise<ReprocessableCorreoLookup> {
    const [row] = await this.database.query<{ correo_id: string; eligible: boolean }>(`
      SELECT
        correo.correo_id::text AS correo_id,
        (
          correo.estado = 'ERROR'
          OR (
            correo.estado = 'PROCESADO'
            AND (
              ${PENDING_FILE_HASH_SQL}
              OR EXISTS (
                SELECT 1
                FROM core.resultados_notificacion_pago resultado
                LEFT JOIN core.empresas_notificacion_pago np ON np.empresa_id = resultado.empresa_id
                WHERE resultado.correo_id = correo.correo_id
                  AND (${MANUAL_OR_ERROR_RESULT_SQL} OR (${OMITTED_COMPANY_ENABLED_SQL}))
              )
            )
          )
        ) AS eligible
      FROM core.correos_notificacion_pago correo
      WHERE correo.correo_id = $1::bigint`, [executionId]);
    if (!row) return { status: 'NOT_FOUND' };
    return row.eligible ? { status: 'FOUND', correoId: row.correo_id } : { status: 'NOT_ELIGIBLE' };
  }

  async findExecutionById(executionId: string): Promise<PaymentNotificationExecutionRow | null> {
    const [execution] = await this.database.query<PaymentNotificationExecutionRow>(`
      SELECT ${EXECUTION_COLUMNS}
      ${EXECUTION_FROM}
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
