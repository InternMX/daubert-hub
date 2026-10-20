import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { AuditIdentity } from '../../common/authenticated-request';
import { mapAudiExecutionState, type AudiProcessingOutcome } from '../audi-processing-status';
import { AutomationTriggerRequestsRepository } from '../trigger-requests/automation-trigger-requests.repository';
import { CaterpillarReprocessWebhookClient } from './caterpillar-reprocess-webhook.client';
import type { ListCaterpillarExecutionsDto } from './dto/list-caterpillar-executions.dto';
import {
  CaterpillarExecutionsRepository,
  type CaterpillarCancellationRow,
  type CaterpillarExecutionDetailRow,
  type CaterpillarExecutionRow,
  type CaterpillarRemissionDetailRow,
  type CaterpillarRemissionRow,
  type CaterpillarReservationRow
} from './caterpillar-executions.repository';
import type { CancelCaterpillarRemissionDto } from './dto/cancel-caterpillar-remission.dto';
import { CaterpillarRoutingService, resolveCaterpillarProcessLabel, type CaterpillarProcessRoute } from './caterpillar-routing.service';

const AUTOMATION_CODE = 'REMISIONES_CATERPILLAR';

// The Hub-facing outcome vocabulary for a reprocess request. Superset of
// CaterpillarReprocessAcceptedStatus/CaterpillarReprocessRejectionReason (both of which pass
// through unchanged) plus the Hub's own upstream-failure classification — see
// CaterpillarController.reprocess for the exact HTTP status each one maps to.
export type CaterpillarReprocessOutcome =
  | 'REPROCESS_CREATED'
  | 'ALREADY_PROCESSING'
  | 'ALREADY_REPROCESSED'
  | 'NOT_FOUND'
  | 'NOT_ELIGIBLE_STATE'
  | 'SOURCE_DOCUMENT_MISSING'
  | 'SOURCE_FILE_UNCLASSIFIABLE_OR_MISSING'
  | 'SOURCE_FILE_MISSING'
  | 'OUTSIDE_TEST_SCOPE'
  | 'OUTSIDE_ALLOWED_SCOPE'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_INVALID_RESPONSE';

export interface CaterpillarReprocessResult {
  outcome: CaterpillarReprocessOutcome;
  originalExecutionId: string;
  // Only ever set alongside an ACCEPTED-class outcome (REPROCESS_CREATED/ALREADY_PROCESSING/
  // ALREADY_REPROCESSED) — n8n never hands back a child execution id for a rejected/failed request.
  executionId: string | null;
}

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
  revision: string | null;
  processLabel: string | null;
  cancellationReason: string | null;
  cancellation: CaterpillarCancellation | null;
  details: CaterpillarRemittanceDetail[];
}

export interface CaterpillarCancellation {
  cancellationId: string;
  userId: string | null;
  userEmail: string;
  userDisplayName: string;
  cancelledAt: string;
  requestId: string | null;
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
  private readonly logger = new Logger(CaterpillarExecutionsService.name);

  constructor(
    private readonly repository: CaterpillarExecutionsRepository,
    private readonly routing: CaterpillarRoutingService,
    private readonly webhookClient: CaterpillarReprocessWebhookClient,
    private readonly triggerRequests: AutomationTriggerRequestsRepository
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

    const [reservations, remissions, audits, routes] = await Promise.all([
      this.repository.findReservationsByExecutionId(executionId),
      this.repository.findRemissionsByExecutionId(executionId),
      this.repository.findCancellationAuditsByExecutionId(executionId),
      this.routing.listRoutes()
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
        remittances: remissions.map((remission) => ({
          ...this.mapRemittance(remission, details),
          processLabel: resolveCaterpillarProcessLabel(routes, [remission.serie_id]),
          cancellation: this.mapCancellation(audits.find((audit) => audit.remision_id === remission.remision_id))
        }))
      }
    };
  }

  async cancelRemission(executionId: string, remissionId: string, input: CancelCaterpillarRemissionDto, requestId: string, identity: AuditIdentity) {
    if (!identity.userId || !identity.userEmail) throw new BadRequestException('No se pudo determinar el usuario autenticado.');
    try {
      const row = await this.repository.cancelRemission(executionId, remissionId, input, identity.userId, requestId);
      return { data: { status: row.resultado, remissionId: row.remision_id, cancellationReason: row.motivo, cancellation: this.mapCancellation(row) } };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'PCA01') throw new NotFoundException('Remisión de Caterpillar no encontrada en esta ejecución.');
      if (code === 'PCA05') throw new ForbiddenException('No tienes permisos para cancelar esta remisión.');
      const messages: Record<string, string> = {
        PCA02: 'No se pueden cancelar remisiones mientras la ejecución está procesando.',
        PCA03: 'La remisión no está en un estado elegible para cancelación.',
        PCA04: 'La remisión cambió. Actualiza el detalle antes de confirmar.'
      };
      if (code && messages[code]) throw new ConflictException({ code: code === 'PCA04' ? 'CATERPILLAR_REMISSION_STALE' : 'CATERPILLAR_CANCEL_NOT_ELIGIBLE', message: messages[code] });
      if (code === '22023') throw new BadRequestException('Solicitud de cancelación no válida.');
      if (code === '42883' || code === '42P01') throw new ServiceUnavailableException('Cancelación no disponible.');
      // Do not return raw SQL, function names, paths or upstream details, including outside HTTP.
      throw new ServiceUnavailableException('No fue posible confirmar la cancelación. Actualiza el detalle antes de reintentar.');
    }
  }

  private mapCancellation(row?: CaterpillarCancellationRow): CaterpillarCancellation | null {
    if (!row?.cancelacion_id) return null;
    return { cancellationId: row.cancelacion_id, userId: row.usuario_id, userEmail: row.usuario_email!, userDisplayName: row.usuario_nombre!, cancelledAt: row.cancelada_en!, requestId: row.request_id };
  }

  // Phase 12C: React never calls n8n directly — this is the one path from an authenticated ADMIN
  // request (CaterpillarController, @Roles('ADMIN')) to the n8n manual-reprocess webhook. The Hub
  // sends only executionId + reason; n8n/PostgreSQL resolve the source document, path,
  // automation, plant, and series entirely on their own side (Phase 12C.2/12C.2a) — this method
  // never derives or forwards any of that itself.
  //
  // Idempotency is NOT reimplemented here: n8n/PostgreSQL already guarantee first request ->
  // REPROCESS_CREATED, repeat while processing -> ALREADY_PROCESSING, repeat after -> already
  // has a child) -> ALREADY_REPROCESSED (Phase 12C.2a §B). This method only translates that
  // existing contract into the Hub's own response shape — never a second idempotency key, lock,
  // or operational record of its own.
  async reprocess(executionId: string, reason: string, requestId: string, identity: AuditIdentity): Promise<CaterpillarReprocessResult> {
    this.assertIdentity(identity);
    const webhookResult = await this.webhookClient.triggerReprocess(executionId, reason);

    if (webhookResult.kind === 'ACCEPTED') {
      await this.recordTriggerRequestSafely('TRIGGERED', requestId, identity, executionId);
      return { outcome: webhookResult.status, originalExecutionId: webhookResult.originalExecutionId, executionId: webhookResult.executionId };
    }

    if (webhookResult.kind === 'REJECTED') {
      // webhookResult.reason is exactly one of the known domain rejections here — the
      // webhook client itself refuses to construct a REJECTED with anything else (an
      // unrecognized error code is INVALID_RESPONSE, handled below, never a fabricated domain
      // rejection). No further mapping/fallback needed.
      await this.recordTriggerRequestSafely('NOTHING_TO_REPROCESS', requestId, identity, executionId);
      return { outcome: webhookResult.reason, originalExecutionId: executionId, executionId: null };
    }

    // NOT_CONFIGURED, TIMEOUT, NETWORK_ERROR, INVALID_RESPONSE — all upstream contract
    // breaks/failures, never a business outcome (an unrecognized accepted/error shape from n8n
    // is INVALID_RESPONSE, not guessed at as a known rejection). Distinguish only timeout (504)
    // from every other upstream failure (502), matching CaterpillarController's HTTP mapping.
    await this.recordTriggerRequestSafely('UPSTREAM_ERROR', requestId, identity, executionId);
    const outcome: CaterpillarReprocessOutcome = webhookResult.kind === 'TIMEOUT'
      ? 'UPSTREAM_TIMEOUT'
      : webhookResult.kind === 'INVALID_RESPONSE'
        ? 'UPSTREAM_INVALID_RESPONSE'
        : 'UPSTREAM_UNAVAILABLE';
    return { outcome, originalExecutionId: executionId, executionId: null };
  }

  private assertIdentity(identity: AuditIdentity): void {
    if (!identity.userEmail) throw new BadRequestException('No se pudo determinar el usuario autenticado.');
  }

  // Best-effort audit trail, written AFTER the webhook call has already resolved — a failure here
  // must never surface as if the reprocess request itself failed (mirrors
  // PaymentNotificationsService.recordTriggerRequestSafely exactly). ops.automation_trigger_requests'
  // outcome column is CHECK-constrained to ('TRIGGERED','NOTHING_TO_REPROCESS','UPSTREAM_ERROR') —
  // the richer n8n/Hub outcome vocabulary above is intentionally collapsed to that existing
  // 3-value enum rather than widening the table (Phase 12C §15 — see final report for the
  // pending-migration note this implies).
  private async recordTriggerRequestSafely(
    outcome: 'TRIGGERED' | 'NOTHING_TO_REPROCESS' | 'UPSTREAM_ERROR',
    requestId: string,
    identity: AuditIdentity,
    targetReference: string
  ): Promise<void> {
    try {
      await this.triggerRequests.record(AUTOMATION_CODE, 'REPROCESS', outcome, requestId, identity, targetReference);
    } catch (error) {
      this.logger.error(`Failed to record automation trigger request audit row (automationCode=${AUTOMATION_CODE}, actionType=REPROCESS, outcome=${outcome}, requestId=${requestId})`, error instanceof Error ? error.stack : error);
    }
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
      revision: remission.revision ?? null,
      processLabel: null,
      cancellationReason: remission.motivo_cancelacion ?? null,
      cancellation: null,
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
