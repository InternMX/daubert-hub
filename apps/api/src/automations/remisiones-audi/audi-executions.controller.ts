import { BadRequestException, Body, Catch, Controller, Get, HttpCode, Param, Post, Query, Req, Res, UseFilters, type ArgumentsHost } from '@nestjs/common';
import type { Response } from 'express';
import { identityFromRequest, type AuthenticatedRequest } from '../../common/authenticated-request';
import { SafeExceptionFilter } from '../../common/http-exception.filter';
import { Roles } from '../../security/route-access.decorators';
import { ListAudiExecutionsDto } from './dto/list-audi-executions.dto';
import { AudiRecoveryActionDto, AudiRecoveryRevisionActionDto } from './dto/audi-recovery-action.dto';
import { AudiExecutionsService, type AudiExecutionDetailResponse, type ListAudiExecutionsResponse } from './audi-executions.service';
import type { AudiRecoveryAction } from './audi-recovery.repository';
import { AudiRecoveryService, AudiRecoveryUnavailable } from './audi-recovery.service';

// Preserve the shared filter's behavior while allowing Audi's fixed 5xx recovery responses.
@Catch(AudiRecoveryUnavailable)
class AudiRecoveryExceptionFilter extends SafeExceptionFilter {
  override catch(exception: AudiRecoveryUnavailable, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().status(exception.getStatus()).json(exception.getResponse());
  }
}

@Controller('automations/remissions/audi')
@UseFilters(new AudiRecoveryExceptionFilter())
export class AudiExecutionsController {
  constructor(private readonly service: AudiExecutionsService, private readonly recovery: AudiRecoveryService) {}

  @Get('executions')
  list(@Query() input: ListAudiExecutionsDto): Promise<ListAudiExecutionsResponse> {
    return this.service.list(input);
  }

  @Get('executions/:executionId')
  getExecutionDetail(@Param('executionId') executionId: string, @Req() request: AuthenticatedRequest): Promise<AudiExecutionDetailResponse> {
    this.assertExecutionId(executionId);
    return this.service.getDetail(executionId, request.user?.role === 'ADMIN');
  }

  @Post('executions/:executionId/reprocess')
  @Roles('ADMIN')
  @HttpCode(202)
  reprocess(
    @Param('executionId') executionId: string,
    @Body() body: AudiRecoveryActionDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.runAction(executionId, 'REPROCESS', body.reason, null, request, response);
  }

  @Post('executions/:executionId/reconcile')
  @Roles('ADMIN')
  @HttpCode(202)
  reconcile(
    @Param('executionId') executionId: string,
    @Body() body: AudiRecoveryRevisionActionDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.runAction(executionId, 'RECONCILE', body.reason, body.expectedRevision, request, response);
  }

  @Post('executions/:executionId/stop')
  @Roles('ADMIN')
  @HttpCode(202)
  stop(
    @Param('executionId') executionId: string,
    @Body() body: AudiRecoveryActionDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.runAction(executionId, 'STOP', body.reason, null, request, response);
  }

  @Post('executions/:executionId/cancel')
  @Roles('ADMIN')
  @HttpCode(202)
  cancel(
    @Param('executionId') executionId: string,
    @Body() body: AudiRecoveryRevisionActionDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.runAction(executionId, 'CANCEL', body.reason, body.expectedRevision, request, response);
  }

  private async runAction(executionId: string, action: AudiRecoveryAction, reason: string, revision: string | null,
    request: AuthenticatedRequest, response: Response) {
    this.assertExecutionId(executionId);
    const result = await this.recovery.requestAction(executionId, action, reason, revision, identityFromRequest(request), request.requestId);
    response.status(result.statusCode);
    return { data: result.data };
  }

  private assertExecutionId(executionId: string): void {
    if (!/^[1-9]\d*$/.test(executionId) || executionId.length > 19 || BigInt(executionId) > 9223372036854775807n) {
      throw new BadRequestException('El identificador de la ejecución debe ser un entero positivo.');
    }
  }
}
