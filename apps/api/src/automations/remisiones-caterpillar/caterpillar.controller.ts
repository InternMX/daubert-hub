import { BadGatewayException, BadRequestException, Body, ConflictException, Controller, Get, GatewayTimeoutException, HttpCode, NotFoundException, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { identityFromRequest, type AuthenticatedRequest } from '../../common/authenticated-request';
import { Roles } from '../../security/route-access.decorators';
import { ListCaterpillarExecutionsDto } from './dto/list-caterpillar-executions.dto';
import { ReprocessCaterpillarExecutionDto } from './dto/reprocess-caterpillar-execution.dto';
import { CancelCaterpillarRemissionDto } from './dto/cancel-caterpillar-remission.dto';
import { RegenerateCaterpillarExecutionDto } from './dto/regenerate-caterpillar-execution.dto';
import { CaterpillarExecutionsService, type CaterpillarExecutionDetailResponse, type CaterpillarReprocessOutcome, type CaterpillarRegenerationOutcome, type ListCaterpillarExecutionsResponse } from './caterpillar-executions.service';
import { CaterpillarRoutingService, type ListCaterpillarSeriesResponse } from './caterpillar-routing.service';

export interface CaterpillarReprocessResponse {
  accepted: true;
  originalExecutionId: string;
  executionId: string;
  status: 'REPROCESS_CREATED' | 'ALREADY_PROCESSING' | 'ALREADY_REPROCESSED';
}

// Route prefix mirrors the existing /automations/remissions/audi convention (see
// AudiExecutionsController) rather than the raw backend automation code, matching
// automations/payment-notifications' naming too. No @Roles(...) at the class level: the GET
// routes remain read-only operational/monitoring data open to both GENERAL and ADMIN, same as
// every other route with no explicit role restriction (see RolesGuard) — Phase 12A.3 §E.
//
// Administrative POST handlers declare @Roles('ADMIN') individually, leaving consultation open.
// Phase 12C reprocess and individual remission cancellation follow the same restriction on
// the handler itself rather than the class, exactly the pattern AutomationsController.adjustDocumentSeries
// already uses for a method-level administrative action inside an otherwise open controller.
@Controller('automations/remissions/caterpillar')
export class CaterpillarController {
  constructor(
    private readonly routing: CaterpillarRoutingService,
    private readonly executions: CaterpillarExecutionsService
  ) {}

  @Get('series')
  listSeries(): Promise<ListCaterpillarSeriesResponse> {
    return this.routing.listSeries();
  }

  @Get('executions')
  listExecutions(@Query() input: ListCaterpillarExecutionsDto): Promise<ListCaterpillarExecutionsResponse> {
    return this.executions.list(input);
  }

  @Get('executions/:executionId')
  getExecutionDetail(@Param('executionId') executionId: string): Promise<CaterpillarExecutionDetailResponse> {
    this.assertExecutionId(executionId);
    return this.executions.getDetail(executionId);
  }

  // React never calls n8n directly (Phase 12C): this is the reprocess write path,
  // and it never accepts a file path, document id, series, plant, or automation code from the
  // client — only executionId (route param, BIGINT-validated exactly like every other executionId
  // route here) and reason (DTO). n8n/PostgreSQL resolve everything else server-side.
  //
  // Idempotency is n8n/PostgreSQL's contract, not reimplemented here — see
  // CaterpillarExecutionsService.reprocess. @HttpCode(202) is the default for every accepted
  // outcome except ALREADY_REPROCESSED, which is genuinely a "nothing new happened" 200 — set
  // imperatively below since a single fixed decorator can't express that per-outcome split.
  @Post('executions/:executionId/reprocess')
  @Roles('ADMIN')
  @HttpCode(202)
  async reprocess(
    @Param('executionId') executionId: string,
    @Body() body: ReprocessCaterpillarExecutionDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ): Promise<CaterpillarReprocessResponse> {
    this.assertExecutionId(executionId);
    const result = await this.executions.reprocess(executionId, body.reason, request.requestId, identityFromRequest(request));

    this.rejectIfError(result.outcome);
    if (result.outcome === 'ALREADY_REPROCESSED') response.status(200);

    return {
      accepted: true,
      originalExecutionId: result.originalExecutionId,
      executionId: result.executionId!,
      status: result.outcome as CaterpillarReprocessResponse['status']
    };
  }

  // Commercial regeneration: a different contract from the technical reprocess above (which keeps accepting only ERROR/CANCELADA). It authorizes the
  // execution in PostgreSQL (ADMIN, COMPLETADA, every remission formally cancelled, mandatory reason) and then asks n8n to run it. 202 only means
  // "started": the new execution appears in the list and is COMPLETADA only when it finishes.
  @Post('executions/:executionId/regenerate')
  @Roles('ADMIN')
  @HttpCode(202)
  async regenerate(
    @Param('executionId') executionId: string,
    @Body() body: RegenerateCaterpillarExecutionDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    this.assertExecutionId(executionId);
    const result = await this.executions.regenerate(executionId, body.reason, request.requestId, identityFromRequest(request));
    this.rejectIfError(result.outcome);
    if (result.outcome === 'ALREADY_REGENERATED') response.status(200);
    return { accepted: true, originalExecutionId: result.originalExecutionId, executionId: result.executionId!, status: result.outcome, authorization: result.authorization };
  }

  @Post('executions/:executionId/remittances/:remissionId/cancel')
  @Roles('ADMIN')
  @HttpCode(200)
  cancelRemission(
    @Param('executionId') executionId: string,
    @Param('remissionId') remissionId: string,
    @Body() body: CancelCaterpillarRemissionDto,
    @Req() request: AuthenticatedRequest
  ) {
    this.assertExecutionId(executionId);
    this.assertExecutionId(remissionId);
    return this.executions.cancelRemission(executionId, remissionId, body, request.requestId, identityFromRequest(request));
  }

  // BIGINT-safe: validated as a digit string and range-checked against int8 max, never coerced
  // through Number()/ParseIntPipe (same rule as PaymentNotificationsController.assertExecutionId).
  private assertExecutionId(executionId: string): void {
    if (!/^[1-9]\d*$/.test(executionId) || BigInt(executionId) > 9223372036854775807n) {
      throw new BadRequestException('El identificador de la ejecución debe ser un entero positivo.');
    }
  }

  // Every non-accepted outcome maps to a thrown HttpException — SafeExceptionFilter turns these
  // into the app's standard sanitized error body, never n8n's raw response.
  private rejectIfError(outcome: CaterpillarReprocessOutcome | CaterpillarRegenerationOutcome): void {
    if (outcome === 'NOT_FOUND') throw new NotFoundException('Ejecución de Caterpillar no encontrada.');
    if (outcome === 'NOT_ELIGIBLE_STATE') throw new ConflictException('Esta ejecución no está en un estado elegible para reproceso.');
    if (outcome === 'SOURCE_DOCUMENT_MISSING') throw new ConflictException('El documento origen no tiene la información necesaria para reprocesar.');
    if (outcome === 'SOURCE_FILE_UNCLASSIFIABLE_OR_MISSING') throw new ConflictException('El archivo origen no está disponible o no se puede clasificar para reprocesar.');
    if (outcome === 'SOURCE_FILE_MISSING') throw new ConflictException('El archivo origen ya no está disponible para reprocesar.');
    if (outcome === 'OUTSIDE_TEST_SCOPE' || outcome === 'OUTSIDE_ALLOWED_SCOPE') throw new ConflictException('La ejecución no pertenece al ámbito permitido para este entorno.');
    if (outcome === 'ADMISSION_REJECTED') throw new ConflictException('El reproceso fue rechazado por las protecciones de folios: la ejecución tiene remisiones vigentes sin conciliar, carece de snapshot o hay un conflicto de programación.');
    if (outcome === 'UPSTREAM_TIMEOUT') throw new GatewayTimeoutException('El servicio de automatización no respondió a tiempo.');
    if (outcome === 'UPSTREAM_UNAVAILABLE' || outcome === 'UPSTREAM_INVALID_RESPONSE') throw new BadGatewayException('No se pudo iniciar el reproceso en este momento.');
  }
}
