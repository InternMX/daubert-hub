import { Injectable, NotFoundException } from '@nestjs/common';
import { mapAudiExecutionState, type AudiProcessingOutcome } from '../audi-processing-status';
import type { ListCaterpillarExecutionsDto } from './dto/list-caterpillar-executions.dto';
import {
  CaterpillarExecutionsRepository,
  type CaterpillarExecutionDetailRow,
  type CaterpillarExecutionRow,
  type CaterpillarRemissionDetailRow,
  type CaterpillarRemissionRow,
  type CaterpillarReservationRow
} from './caterpillar-executions.repository';
import { CaterpillarRoutingService, resolveCaterpillarProcessLabel, type CaterpillarProcessRoute } from './caterpillar-routing.service';

export interface CaterpillarExecutionSummary {
  executionId: string;
  outcome: AudiProcessingOutcome;
  startedAt: string;
  finishedAt: string | null;
  failedAttempts: number;
  maxAttempts: number;
  latestErrorNode: string | null;
  latestErrorMessage: string | null;
  n8nExecutionId: string | null;
  sourceDocumentId: string;
  sourceFilename: string;
  generatedRemissionCount: number;
  minimumFolio: string | null;
  maximumFolio: string | null;
  // null whenever the route cannot be derived unambiguously — e.g. zero/multiple reserved series,
  // or a series shared by more than one route (Torreón), never a guess (Phase 12A.3 §C).
  processLabel: string | null;
}

export interface ListCaterpillarExecutionsResponse {
  data: CaterpillarExecutionSummary[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface CaterpillarSourceDocument {
  documentId: string;
  filename: string;
  path: string;
  hash: string | null;
  origin: string | null;
  documentDate: string | null;
}

export interface CaterpillarFolioReservation {
  reservationId: string;
  seriesId: string;
  seriesCode: string;
  folioInicial: string;
  folioFinal: string;
  quantity: number;
  status: string;
}

export interface CaterpillarRemittanceDetail {
  detailId: string;
  internalCode: string | null;
  partNumber: string | null;
  description: string | null;
  quantityText: string;
}

export interface CaterpillarRemittance {
  remissionId: string;
  seriesId: string;
  seriesCode: string;
  folio: string;
  documentDate: string;
  // Plain text only — never resolved to a file/URL, no filesystem or Dropbox access (Phase 12A.3 §D).
  pdfPath: string | null;
  status: string;
  details: CaterpillarRemittanceDetail[];
}

export interface CaterpillarExecutionDetail {
  executionId: string;
  outcome: AudiProcessingOutcome;
  startedAt: string;
  finishedAt: string | null;
  failedAttempts: number;
  maxAttempts: number;
  latestErrorNode: string | null;
  latestErrorMessage: string | null;
  n8nExecutionId: string | null;
  reprocessOfExecutionId: string | null;
  sourceDocument: CaterpillarSourceDocument;
  reservations: CaterpillarFolioReservation[];
  remittances: CaterpillarRemittance[];
}

export interface CaterpillarExecutionDetailResponse {
  data: CaterpillarExecutionDetail;
}

@Injectable()
export class CaterpillarExecutionsService {
  constructor(
    private readonly repository: CaterpillarExecutionsRepository,
    private readonly routing: CaterpillarRoutingService
  ) {}

  // Zero Caterpillar executions in production today is a normal, valid state (Phase 12A.3 §C) —
  // this returns an ordinary empty data array with a correct meta block, never an error.
  async list(input: ListCaterpillarExecutionsDto): Promise<ListCaterpillarExecutionsResponse> {
    const [{ total, executions }, routes] = await Promise.all([
      this.repository.list(input.page, input.pageSize),
      this.routing.listRoutes()
    ]);
    return {
      data: executions.map((execution) => this.mapSummary(execution, routes)),
      meta: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) }
    };
  }

  // 404 both when the id does not exist at all and when it belongs to a different automation
  // (e.g. an Audi execution id) — CaterpillarExecutionsRepository.findById's own JOIN already
  // scopes to REMISIONES_CATERPILLAR, so both cases come back as the same null here (Phase 12A.3 §D).
  async getDetail(executionId: string): Promise<CaterpillarExecutionDetailResponse> {
    const execution = await this.repository.findById(executionId);
    if (!execution) throw new NotFoundException('Ejecución de Caterpillar no encontrada.');

    const [reservations, remissions] = await Promise.all([
      this.repository.findReservationsByExecutionId(executionId),
      this.repository.findRemissionsByExecutionId(executionId)
    ]);
    const details = remissions.length > 0
      ? await this.repository.findDetailsByRemisionIds(remissions.map((remission) => remission.remision_id))
      : [];

    return {
      data: {
        executionId: execution.ejecucion_id,
        outcome: this.mapOutcome(execution.execution_state),
        startedAt: new Date(execution.started_at).toISOString(),
        finishedAt: execution.finished_at ? new Date(execution.finished_at).toISOString() : null,
        failedAttempts: execution.failed_attempts,
        maxAttempts: execution.max_attempts,
        latestErrorNode: execution.error_node,
        latestErrorMessage: execution.error_message,
        n8nExecutionId: execution.n8n_execution_id,
        reprocessOfExecutionId: execution.reproceso_de_id,
        sourceDocument: this.mapSourceDocument(execution),
        reservations: reservations.map((reservation) => this.mapReservation(reservation)),
        remittances: remissions.map((remission) => this.mapRemittance(remission, details))
      }
    };
  }

  private mapSummary(execution: CaterpillarExecutionRow, routes: CaterpillarProcessRoute[]): CaterpillarExecutionSummary {
    return {
      executionId: execution.ejecucion_id,
      outcome: this.mapOutcome(execution.execution_state),
      startedAt: new Date(execution.started_at).toISOString(),
      finishedAt: execution.finished_at ? new Date(execution.finished_at).toISOString() : null,
      failedAttempts: execution.failed_attempts,
      maxAttempts: execution.max_attempts,
      latestErrorNode: execution.error_node,
      latestErrorMessage: execution.error_message,
      n8nExecutionId: execution.n8n_execution_id,
      sourceDocumentId: execution.documento_id,
      sourceFilename: execution.source_filename,
      generatedRemissionCount: execution.generated_count,
      minimumFolio: execution.minimum_folio,
      maximumFolio: execution.maximum_folio,
      processLabel: resolveCaterpillarProcessLabel(routes, execution.reservation_serie_ids ?? [])
    };
  }

  // ops.ejecuciones_automatizacion.estado is DB-CHECK-constrained to the four known values (same
  // guarantee AudiExecutionsService relies on) — a null here would mean the constraint itself
  // changed, so this fails loudly rather than silently fabricating an outcome.
  private mapOutcome(state: string): AudiProcessingOutcome {
    return mapAudiExecutionState(state)!;
  }

  private mapSourceDocument(execution: CaterpillarExecutionDetailRow): CaterpillarSourceDocument {
    return {
      documentId: execution.documento_id,
      filename: execution.source_filename,
      path: execution.source_path,
      hash: execution.source_hash,
      origin: execution.source_origin,
      documentDate: execution.source_document_date ? this.formatDate(execution.source_document_date) : null
    };
  }

  private mapReservation(reservation: CaterpillarReservationRow): CaterpillarFolioReservation {
    return {
      reservationId: reservation.reserva_id,
      seriesId: reservation.serie_id,
      seriesCode: reservation.serie_codigo,
      folioInicial: reservation.folio_inicial,
      folioFinal: reservation.folio_final,
      quantity: reservation.cantidad,
      status: reservation.estatus
    };
  }

  private mapRemittance(remission: CaterpillarRemissionRow, allDetails: CaterpillarRemissionDetailRow[]): CaterpillarRemittance {
    return {
      remissionId: remission.remision_id,
      seriesId: remission.serie_id,
      seriesCode: remission.serie_codigo,
      folio: remission.folio,
      documentDate: this.formatDate(remission.fecha_documento),
      pdfPath: remission.pdf_path,
      status: remission.estatus,
      details: allDetails
        .filter((detail) => detail.remision_id === remission.remision_id)
        .map((detail) => ({
          detailId: detail.detalle_id,
          internalCode: detail.codigo_interno,
          partNumber: detail.part_number,
          description: detail.descripcion,
          quantityText: detail.cantidad_texto
        }))
    };
  }

  // fecha_documento is a DATE column (no time-of-day component) — normalized to its YYYY-MM-DD
  // text form rather than a full ISO timestamp, which would fabricate a 00:00 time-of-day the
  // database never stored.
  private formatDate(value: Date | string): string {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return value;
  }
}
