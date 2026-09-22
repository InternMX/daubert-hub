import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../../database/database.service';

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
        remision.estatus AS estatus
      FROM operacion.remisiones remision
      JOIN operacion.series_documentales serie ON serie.serie_id = remision.serie_id
      WHERE remision.ejecucion_id = $1::bigint
      ORDER BY remision.remision_id`, [executionId]);
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
