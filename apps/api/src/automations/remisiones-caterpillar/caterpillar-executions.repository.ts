import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../../database/database.service';
import type { CancelCaterpillarRemissionDto } from './dto/cancel-caterpillar-remission.dto';
import { assertAtomicAdmissionInput, assertAtomicAdmissionResult, type CaterpillarAtomicAdmissionInput,
  type CaterpillarAtomicAdmissionRow } from './caterpillar-atomic-admission';
import { createCaterpillarAdmissionCandidate, createCaterpillarAdmissionSnapshot, readCaterpillarAdmissionSnapshot,
  type CaterpillarAdmissionHistoryEntry, type CaterpillarAdmissionSnapshot } from './caterpillar-automatic-admission';

export interface CaterpillarAdmissionHistoryRow extends QueryResultRow {
  database_name: string;
  snapshot_storage_ready: boolean;
  entries: CaterpillarAdmissionHistoryEntry[];
}
export interface CaterpillarSnapshotDocument {
  documentId: string;
  sourceCompanyId: string;
  fileName: string;
  writable: boolean;
}
export interface CaterpillarSnapshotReadResult {
  status: 'UNAVAILABLE' | 'NOT_FOUND' | 'EMPTY' | 'FOUND' | 'INVALID';
  document: CaterpillarSnapshotDocument | null;
  snapshot: CaterpillarAdmissionSnapshot | null;
}
export interface CaterpillarSnapshotWriteResult {
  status: 'STORED' | 'ALREADY_STORED' | 'CONFLICT' | 'UNAVAILABLE' | 'NOT_FOUND' | 'HISTORICAL_LOCKED';
  snapshot: CaterpillarAdmissionSnapshot | null;
}
interface CaterpillarSnapshotRow extends QueryResultRow {
  document_id: string;
  source_company_id: string;
  file_name: string;
  snapshot: unknown;
  is_empty: boolean;
  writable: boolean;
}

// Used in both read and compare-and-set: no snapshot backfill after terminal attempts/folios.
const SNAPSHOT_WRITABLE = `NOT EXISTS (
  SELECT 1 FROM ops.ejecuciones_automatizacion e WHERE e.documento_origen_id=d.documento_id
    AND (e.estado<>'PROCESANDO'
      OR EXISTS(SELECT 1 FROM operacion.remisiones r WHERE r.ejecucion_id=e.ejecucion_id)
      OR EXISTS(SELECT 1 FROM operacion.reservas_folios f WHERE f.ejecucion_id=e.ejecucion_id))
)`;
const SNAPSHOT_DOCUMENT_SCOPE = `current_database()='daubert_hub_test'
  AND d.documento_id=$1::bigint AND d.empresa_id=$2::bigint AND d.tipo_documento='PROGRAMACION_ENTREGA'
  AND NOT EXISTS(SELECT 1 FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id)
    WHERE e.documento_origen_id=d.documento_id AND a.codigo<>'REMISIONES_CATERPILLAR')`;

export interface CaterpillarCancellationRow extends QueryResultRow {
  remision_id: string;
  motivo: string | null;
  cancelacion_id: string | null;
  usuario_id: string | null;
  usuario_email: string | null;
  usuario_nombre: string | null;
  cancelada_en: string | null;
  request_id: string | null;
}

export interface CaterpillarCancelResultRow extends CaterpillarCancellationRow {
  resultado: 'CANCELLED' | 'ALREADY_CANCELLED';
}

export interface CaterpillarRegenerationAuthorizationRow extends QueryResultRow {
  resultado?: 'AUTHORIZED' | 'ALREADY_AUTHORIZED';
  autorizacion_id: string;
  ejecucion_origen_id: string;
  motivo: string;
  usuario_id: string | null;
  usuario_email: string;
  usuario_nombre: string;
  autorizada_en: string;
  request_id: string | null;
  ejecucion_nueva_id: string | null;
}

// What the detail needs to tell the UI whether a commercial regeneration is possible. The decision itself is always re-taken in PostgreSQL.
export interface CaterpillarRegenerationContextRow extends QueryResultRow {
  available: boolean;
  has_snapshot: boolean;
  has_child: boolean;
  authorization: CaterpillarRegenerationAuthorizationRow | null;
}

export interface CaterpillarExecutionRow extends QueryResultRow {
  ejecucion_id: string;
  execution_state: string;
  started_at: Date | string;
  finished_at: Date | string | null;
  failed_attempts: number;
  max_attempts: number;
  error_node: string | null;
  error_message: string | null;
  n8n_execution_id: string | null;
  documento_id: string;
  source_filename: string;
  generated_count: number;
  minimum_folio: string | null;
  maximum_folio: string | null;
  // text[] of the distinct serie_id values this execution reserved folios in — used only to
  // resolve a process label (see resolveCaterpillarProcessLabel), never returned to the client.
  reservation_serie_ids: string[] | null;
}

export interface ListedCaterpillarExecutions {
  total: number;
  executions: CaterpillarExecutionRow[];
}

export interface CaterpillarExecutionDetailRow extends QueryResultRow {
  ejecucion_id: string;
  execution_state: string;
  started_at: Date | string;
  finished_at: Date | string | null;
  failed_attempts: number;
  max_attempts: number;
  error_node: string | null;
  error_message: string | null;
  n8n_execution_id: string | null;
  reproceso_de_id: string | null;
  documento_id: string;
  source_filename: string;
  source_path: string;
  source_hash: string | null;
  source_origin: string | null;
  source_document_date: Date | string | null;
}

export interface CaterpillarReservationRow extends QueryResultRow {
  reserva_id: string;
  serie_id: string;
  serie_codigo: string;
  folio_inicial: string;
  folio_final: string;
  cantidad: number;
  estatus: string;
}

export interface CaterpillarRemissionRow extends QueryResultRow {
  remision_id: string;
  serie_id: string;
  serie_codigo: string;
  folio: string;
  fecha_documento: Date | string;
  pdf_path: string | null;
  estatus: string;
  revision: string;
  motivo_cancelacion: string | null;
}

export interface CaterpillarRemissionDetailRow extends QueryResultRow {
  detalle_id: string;
  remision_id: string;
  codigo_interno: string | null;
  part_number: string | null;
  descripcion: string | null;
  cantidad_texto: string;
}

const EXECUTION_COLUMNS = `
    execution.ejecucion_id::text AS ejecucion_id,
    execution.estado AS execution_state,
    execution.iniciada_en AS started_at,
    execution.finalizada_en AS finished_at,
    execution.intentos_fallidos AS failed_attempts,
    execution.max_intentos AS max_attempts,
    execution.error_nodo AS error_node,
    execution.error_mensaje AS error_message,
    execution.n8n_execution_id AS n8n_execution_id`;

@Injectable()
export class CaterpillarExecutionsRepository {
  constructor(private readonly database: DatabaseService) {}

  // Worker-only prepared contract (015 not applied). Hub runtime is deliberately NOT granted EXECUTE.
  // No controller calls this. It is a single statement, never advisory SELECT + independent reserve.
  async claimAdmissionAndReserve(input: CaterpillarAtomicAdmissionInput): Promise<CaterpillarAtomicAdmissionRow> {
    assertAtomicAdmissionInput(input);
    const [row] = await this.database.query<CaterpillarAtomicAdmissionRow>(`
      SELECT decision,reason,can_emit,worker_id,ejecucion_id::text,reserva_id::text,
        folio_inicial::text,folio_final::text,cantidad,legacy_unverified
      FROM ops.fn_admitir_reservar_caterpillar_test($1::bigint,$2::text,$3::text,$4::integer)`,
    [input.documentId,input.workerId,input.seriesCode,input.quantity]);
    return assertAtomicAdmissionResult(row,input);
  }

  // Manual reprocess of an ERROR/CANCELADA parent (ADMIN is enforced by Hub/n8n before this call). Same single-statement,
  // worker-only contract: child creation and NEW folio reservation are atomic. Not called by any controller.
  async claimReprocessAndReserve(input: CaterpillarAtomicAdmissionInput): Promise<CaterpillarAtomicAdmissionRow> {
    assertAtomicAdmissionInput(input); // documentId carries the PARENT execution id here
    const [row] = await this.database.query<CaterpillarAtomicAdmissionRow>(`
      SELECT decision,reason,can_emit,worker_id,ejecucion_id::text,reserva_id::text,
        folio_inicial::text,folio_final::text,cantidad,legacy_unverified
      FROM ops.fn_reprocesar_reservar_caterpillar_test($1::bigint,$2::text,$3::text,$4::integer)`,
    [input.documentId,input.workerId,input.seriesCode,input.quantity]);
    return assertAtomicAdmissionResult(row,input,['REPROCESS_ACQUIRED','OWNED_RETRY']);
  }

  async findAdmissionSnapshot(documentId: string, sourceCompanyId: string): Promise<CaterpillarSnapshotReadResult> {
    const [storage] = await this.database.query<{ database_name: string; ready: boolean }>(`
      SELECT current_database() AS database_name, EXISTS(SELECT 1 FROM pg_catalog.pg_attribute
        WHERE attrelid='core.documentos'::regclass AND attname='caterpillar_admission'
          AND atttypid='jsonb'::regtype AND NOT attisdropped) AS ready`);
    if (storage?.database_name !== 'daubert_hub_test' || !storage.ready) return { status: 'UNAVAILABLE', document: null, snapshot: null };
    const [row] = await this.database.query<CaterpillarSnapshotRow>(`
      SELECT d.documento_id::text AS document_id,d.empresa_id::text AS source_company_id,
        d.nombre_archivo AS file_name,d.caterpillar_admission AS snapshot,
        d.caterpillar_admission IS NULL AS is_empty, ${SNAPSHOT_WRITABLE} AS writable
      FROM core.documentos d WHERE ${SNAPSHOT_DOCUMENT_SCOPE}`, [documentId, sourceCompanyId]);
    if (!row) return { status: 'NOT_FOUND', document: null, snapshot: null };
    const document = { documentId: row.document_id, sourceCompanyId: row.source_company_id, fileName: row.file_name, writable: row.writable };
    if (row.is_empty) return { status: 'EMPTY', document, snapshot: null };
    const snapshot = readCaterpillarAdmissionSnapshot(row.snapshot, row.source_company_id, row.file_name);
    return { status: snapshot ? 'FOUND' : 'INVALID', document, snapshot };
  }

  // Prepared only: no route/workflow calls this method. Capture before reservations/emission.
  // The SQL compare-and-set protects snapshot immutability, NOT admission/reservation concurrency.
  async storeAdmissionSnapshot(documentId: string, sourceCompanyId: string, normalizedItems: unknown): Promise<CaterpillarSnapshotWriteResult> {
    const current = await this.findAdmissionSnapshot(documentId, sourceCompanyId);
    if (current.status === 'UNAVAILABLE' || current.status === 'NOT_FOUND') return { status: current.status, snapshot: null };
    if (current.status === 'INVALID' || !current.document) return { status: 'CONFLICT', snapshot: null };
    const desired = createCaterpillarAdmissionSnapshot(createCaterpillarAdmissionCandidate({
      sourceCompanyId: current.document.sourceCompanyId, fileName: current.document.fileName, normalizedItems
    }));
    const same = (other: CaterpillarAdmissionSnapshot | null) => other?.version === desired.version &&
      other.programmingKey === desired.programmingKey && other.manifestCanonical === desired.manifestCanonical;
    if (current.status === 'FOUND') return { status: same(current.snapshot) ? 'ALREADY_STORED' : 'CONFLICT', snapshot: current.snapshot };
    if (!current.document.writable) return { status: 'HISTORICAL_LOCKED', snapshot: null };
    const stored = await this.database.query<{ snapshot: CaterpillarAdmissionSnapshot }>(`
      UPDATE core.documentos d SET caterpillar_admission=$3::jsonb
      WHERE ${SNAPSHOT_DOCUMENT_SCOPE} AND d.nombre_archivo=$4::text
        AND d.caterpillar_admission IS NULL AND ${SNAPSHOT_WRITABLE}
      RETURNING d.caterpillar_admission AS snapshot`, [documentId, sourceCompanyId, JSON.stringify(desired), current.document.fileName]);
    if (stored.length) return { status: 'STORED', snapshot: desired };
    // A changed snapshot/document is never overwritten, including a competing initial capture.
    const after = await this.findAdmissionSnapshot(documentId, sourceCompanyId);
    if (after.status === 'UNAVAILABLE' || after.status === 'NOT_FOUND') return { status: after.status, snapshot: null };
    if (after.status === 'FOUND') return { status: same(after.snapshot) ? 'ALREADY_STORED' : 'CONFLICT', snapshot: after.snapshot };
    return { status: after.document?.writable === false ? 'HISTORICAL_LOCKED' : 'CONFLICT', snapshot: null };
  }

  // Read only, all versions/hashes and all Caterpillar attempts. No pagination/latest-row shortcut.
  // to_jsonb avoids referencing an uninstalled column; absent storage is explicitly NOT readiness.
  async findAutomaticAdmissionHistory(sourceCompanyId: string): Promise<CaterpillarAdmissionHistoryRow | null> {
    const [row] = await this.database.query<CaterpillarAdmissionHistoryRow>(`
      WITH history AS (
        SELECT d.documento_id, e.ejecucion_id,
          jsonb_build_object(
            'documentId', d.documento_id::text, 'sourceCompanyId', d.empresa_id::text,
            'fileName', d.nombre_archivo, 'executionId', e.ejecucion_id::text,
            'executionState', e.estado, 'generatedCount', counts.generated_count,
            'cancelledCount', counts.cancelled_count, 'pendingCount', counts.pending_count,
            'admissionSnapshot', to_jsonb(d)->'caterpillar_admission'
          ) AS entry
        FROM core.documentos d
        LEFT JOIN ops.ejecuciones_automatizacion e
          ON e.documento_origen_id = d.documento_id
         AND EXISTS (SELECT 1 FROM ops.automatizaciones a
           WHERE a.automatizacion_id = e.automatizacion_id AND a.codigo = 'REMISIONES_CATERPILLAR')
        LEFT JOIN LATERAL (
          SELECT count(*) FILTER (WHERE r.estatus='GENERADA')::int AS generated_count,
            count(*) FILTER (WHERE r.estatus='CANCELADA')::int AS cancelled_count,
            count(*) FILTER (WHERE r.estatus='PENDIENTE')::int AS pending_count
          FROM operacion.remisiones r WHERE r.ejecucion_id=e.ejecucion_id
        ) counts ON true
        WHERE current_database()='daubert_hub_test' AND d.empresa_id=$1::bigint
          AND (e.ejecucion_id IS NOT NULL OR NULLIF(to_jsonb(d)->'caterpillar_admission','null'::jsonb) IS NOT NULL)
      )
      SELECT current_database() AS database_name,
        EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
          WHERE attrelid='core.documentos'::regclass AND attname='caterpillar_admission'
            AND atttypid='jsonb'::regtype AND NOT attisdropped) AS snapshot_storage_ready,
        COALESCE((SELECT jsonb_agg(entry ORDER BY documento_id,ejecucion_id) FROM history),'[]'::jsonb) AS entries`, [sourceCompanyId]);
    return row ?? null;
  }

  async list(page: number, pageSize: number): Promise<ListedCaterpillarExecutions> {
    const [totalRow] = await this.database.query<{ total: number }>(`
      SELECT count(*)::int AS total
      FROM ops.ejecuciones_automatizacion execution
      JOIN ops.automatizaciones automation
        ON automation.automatizacion_id = execution.automatizacion_id
       AND automation.codigo = 'REMISIONES_CATERPILLAR'`);
    // remission_summary/reservation_series are grouped on the raw child tables with no automation
    // filter of their own (never parsing operacion.series_documentales.codigo, per Phase 12A.3
    // §B) — this is safe because both are only ever joined by ejecucion_id against the already
    // REMISIONES_CATERPILLAR-scoped execution rows below, so a row from a different automation's
    // execution can never leak in.
    const executions = await this.database.query<CaterpillarExecutionRow>(`
      WITH remission_summary AS (
        SELECT
          remission.ejecucion_id,
          count(*) FILTER (WHERE remission.estatus = 'GENERADA')::int AS generated_count,
          min(remission.folio) FILTER (WHERE remission.estatus = 'GENERADA') AS minimum_folio,
          max(remission.folio) FILTER (WHERE remission.estatus = 'GENERADA') AS maximum_folio
        FROM operacion.remisiones remission
        GROUP BY remission.ejecucion_id
      ),
      reservation_series AS (
        SELECT reserva.ejecucion_id, array_agg(DISTINCT reserva.serie_id::text) AS serie_ids
        FROM operacion.reservas_folios reserva
        GROUP BY reserva.ejecucion_id
      )
      SELECT
        ${EXECUTION_COLUMNS},
        documento.documento_id::text AS documento_id,
        documento.nombre_archivo AS source_filename,
        COALESCE(summary.generated_count, 0) AS generated_count,
        summary.minimum_folio::text AS minimum_folio,
        summary.maximum_folio::text AS maximum_folio,
        reservation.serie_ids AS reservation_serie_ids
      FROM ops.ejecuciones_automatizacion execution
      JOIN ops.automatizaciones automation
        ON automation.automatizacion_id = execution.automatizacion_id
       AND automation.codigo = 'REMISIONES_CATERPILLAR'
      JOIN core.documentos documento
        ON documento.documento_id = execution.documento_origen_id
      LEFT JOIN remission_summary summary
        ON summary.ejecucion_id = execution.ejecucion_id
      LEFT JOIN reservation_series reservation
        ON reservation.ejecucion_id = execution.ejecucion_id
      ORDER BY execution.ejecucion_id DESC
      LIMIT $1 OFFSET $2`, [pageSize, (page - 1) * pageSize]);
    return { total: totalRow?.total ?? 0, executions };
  }

  // The JOIN to automation.codigo = 'REMISIONES_CATERPILLAR' is what makes this both a "does it
  // exist" and a "does it belong to Caterpillar" check in one query — an Audi (or any other
  // automation's) execution id simply does not match and correctly returns null here, which the
  // controller/service turns into a 404 (Phase 12A.3 §D).
  async findById(executionId: string): Promise<CaterpillarExecutionDetailRow | null> {
    const [row] = await this.database.query<CaterpillarExecutionDetailRow>(`
      SELECT
        ${EXECUTION_COLUMNS},
        execution.reproceso_de_id::text AS reproceso_de_id,
        documento.documento_id::text AS documento_id,
        documento.nombre_archivo AS source_filename,
        documento.ruta_archivo AS source_path,
        documento.hash_archivo AS source_hash,
        documento.origen AS source_origin,
        documento.fecha_documento AS source_document_date
      FROM ops.ejecuciones_automatizacion execution
      JOIN ops.automatizaciones automation
        ON automation.automatizacion_id = execution.automatizacion_id
       AND automation.codigo = 'REMISIONES_CATERPILLAR'
      JOIN core.documentos documento
        ON documento.documento_id = execution.documento_origen_id
      WHERE execution.ejecucion_id = $1::bigint`, [executionId]);
    return row ?? null;
  }

  async findReservationsByExecutionId(executionId: string): Promise<CaterpillarReservationRow[]> {
    return this.database.query<CaterpillarReservationRow>(`
      SELECT
        reserva.reserva_id::text AS reserva_id,
        reserva.serie_id::text AS serie_id,
        serie.codigo AS serie_codigo,
        reserva.folio_inicial::text AS folio_inicial,
        reserva.folio_final::text AS folio_final,
        reserva.cantidad AS cantidad,
        reserva.estatus AS estatus
      FROM operacion.reservas_folios reserva
      JOIN operacion.series_documentales serie ON serie.serie_id = reserva.serie_id
      WHERE reserva.ejecucion_id = $1::bigint
      ORDER BY reserva.reserva_id`, [executionId]);
  }

  async findRemissionsByExecutionId(executionId: string): Promise<CaterpillarRemissionRow[]> {
    return this.database.query<CaterpillarRemissionRow>(`
      SELECT
        remision.remision_id::text AS remision_id,
        remision.serie_id::text AS serie_id,
        serie.codigo AS serie_codigo,
        remision.folio::text AS folio,
        remision.fecha_documento AS fecha_documento,
        remision.pdf_path AS pdf_path,
        remision.estatus AS estatus,
        remision.motivo_cancelacion,
        to_char(remision.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS revision
      FROM operacion.remisiones remision
      JOIN operacion.series_documentales serie ON serie.serie_id = remision.serie_id
      WHERE remision.ejecucion_id = $1::bigint
      ORDER BY remision.remision_id`, [executionId]);
  }

  async findCancellationAuditsByExecutionId(executionId: string): Promise<CaterpillarCancellationRow[]> {
    // Preserve read-only details/reprocess before migration 013. Never cache absence across requests.
    const [schema] = await this.database.query<{ available: boolean }>(
      "SELECT to_regclass('operacion.cancelaciones_remisiones') IS NOT NULL AS available");
    if (!schema?.available) return [];
    return this.database.query<CaterpillarCancellationRow>(`
      SELECT c.remision_id::text, c.motivo, c.cancelacion_id::text, c.usuario_id::text,
        c.usuario_email, c.usuario_nombre,
        to_char(c.cancelada_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cancelada_en,
        c.request_id
      FROM operacion.cancelaciones_remisiones c
      JOIN operacion.remisiones r ON r.remision_id = c.remision_id
      JOIN ops.ejecuciones_automatizacion e ON e.ejecucion_id = r.ejecucion_id
      JOIN ops.automatizaciones a ON a.automatizacion_id = e.automatizacion_id
      WHERE e.ejecucion_id = $1::bigint AND a.codigo = 'REMISIONES_CATERPILLAR'`, [executionId]);
  }

  async cancelRemission(executionId: string, remissionId: string, input: CancelCaterpillarRemissionDto, userId: string, requestId: string): Promise<CaterpillarCancelResultRow> {
    // One statement = one transaction. The definer function owns locks, UPDATE and mandatory audit.
    const [row] = await this.database.query<CaterpillarCancelResultRow>(`
      SELECT resultado, remision_id::text, motivo, cancelacion_id::text, usuario_id::text,
        usuario_email, usuario_nombre, cancelada_en, request_id
      FROM operacion.fn_cancelar_remision_caterpillar($1::bigint, $2::bigint, $3::text, $4::text, $5::bigint, $6::text)`,
    [executionId, remissionId, input.expectedRevision, input.reason, userId, requestId]);
    if (!row) throw new Error('Missing cancellation result');
    return row;
  }

  // Read-only and tolerant of a database that does not have migration 017 (or 014) yet: absence is never cached and never an error.
  async findRegenerationContext(executionId: string): Promise<CaterpillarRegenerationContextRow> {
    const [schema] = await this.database.query<{ available: boolean }>(
      "SELECT to_regclass('operacion.autorizaciones_regeneracion_caterpillar') IS NOT NULL AS available");
    if (!schema?.available) return { available: false, has_snapshot: false, has_child: false, authorization: null };
    const [row] = await this.database.query<CaterpillarRegenerationContextRow>(`
      SELECT true AS available,
        COALESCE((to_jsonb(d)->'caterpillar_admission') IS NOT NULL AND (to_jsonb(d)->'caterpillar_admission')<>'null'::jsonb, false) AS has_snapshot,
        EXISTS(SELECT 1 FROM ops.ejecuciones_automatizacion c WHERE c.reproceso_de_id=e.ejecucion_id) AS has_child,
        (SELECT jsonb_build_object('autorizacion_id',x.autorizacion_id::text,'ejecucion_origen_id',x.ejecucion_origen_id::text,'motivo',x.motivo,'usuario_id',x.usuario_id::text,
          'usuario_email',x.usuario_email,'usuario_nombre',x.usuario_nombre,'request_id',x.request_id,'ejecucion_nueva_id',x.ejecucion_nueva_id::text,
          'autorizada_en',to_char(x.autorizada_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
          FROM operacion.autorizaciones_regeneracion_caterpillar x WHERE x.ejecucion_origen_id=e.ejecucion_id) AS authorization
      FROM ops.ejecuciones_automatizacion e JOIN core.documentos d ON d.documento_id=e.documento_origen_id
      JOIN ops.automatizaciones a ON a.automatizacion_id=e.automatizacion_id
      WHERE e.ejecucion_id=$1::bigint AND a.codigo='REMISIONES_CATERPILLAR'`, [executionId]);
    return row ?? { available: true, has_snapshot: false, has_child: false, authorization: null };
  }

  // One statement = one transaction. The definer function validates ADMIN, state, snapshot, formal cancellation of every remission, and records
  // the single-use authorization; the Hub never writes the table itself.
  async authorizeRegeneration(executionId: string, reason: string, userId: string, requestId: string): Promise<CaterpillarRegenerationAuthorizationRow> {
    const [row] = await this.database.query<CaterpillarRegenerationAuthorizationRow>(`
      SELECT resultado, autorizacion_id::text, ejecucion_origen_id::text, motivo, usuario_id::text, usuario_email, usuario_nombre, autorizada_en, request_id, ejecucion_nueva_id::text
      FROM operacion.fn_autorizar_regeneracion_caterpillar($1::bigint, $2::text, $3::bigint, $4::text)`, [executionId, reason, userId, requestId]);
    if (!row) throw new Error('Missing regeneration authorization result');
    return row;
  }

  // remisionIds bound as a single parameterized bigint[] array (= ANY($1::bigint[])), never
  // string-interpolated even though the caller passes multiple ids.
  async findDetailsByRemisionIds(remisionIds: readonly string[]): Promise<CaterpillarRemissionDetailRow[]> {
    if (remisionIds.length === 0) return [];
    return this.database.query<CaterpillarRemissionDetailRow>(`
      SELECT
        detalle.detalle_id::text AS detalle_id,
        detalle.remision_id::text AS remision_id,
        detalle.codigo_interno AS codigo_interno,
        detalle.part_number AS part_number,
        detalle.descripcion AS descripcion,
        detalle.cantidad_texto AS cantidad_texto
      FROM operacion.remision_detalle detalle
      WHERE detalle.remision_id = ANY($1::bigint[])
      ORDER BY detalle.remision_id, detalle.detalle_id`, [remisionIds]);
  }
}
