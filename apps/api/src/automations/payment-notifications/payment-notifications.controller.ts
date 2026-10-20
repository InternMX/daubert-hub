import { BadGatewayException, BadRequestException, Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { identityFromRequest, type AuthenticatedRequest } from '../../common/authenticated-request';
import { ListPaymentNotificationsDto } from './dto/list-payment-notifications.dto';
import { PaymentNotificationsService, type ListPaymentNotificationsResponse, type PaymentNotificationExecutionDetailResponse } from './payment-notifications.service';
import { PaymentFileAssignmentDto } from './dto/payment-file-assignment.dto';

// No @Roles(...): this is an operational module (read-only listing plus the "Reprocesar" manual
// control, PN1.2) open to both GENERAL and ADMIN, same as every other route in this app with no
// explicit role restriction (see RolesGuard) — these are operational actions, not automation
// administration.
//
// PN1.2 final scope cleanup: "Ejecutar ahora" (RUN) was removed from Payment Notifications —
// the production n8n workflow already polls independently on its own schedule, so a manual
// trigger for it added no value. Reprocesar (REPROCESS) is unaffected and remains the only
// manual control here.
@Controller('automations/payment-notifications')
export class PaymentNotificationsController {
  constructor(private readonly service: PaymentNotificationsService) {}

  @Patch(':executionId/files/:fileId/assignment')
  assignFile(@Param('executionId') executionId: string, @Param('fileId') fileId: string, @Body() input: PaymentFileAssignmentDto, @Req() request: AuthenticatedRequest) {
    this.assertExecutionId(executionId);
    this.assertExecutionId(fileId);
    if (input.companyId !== undefined) this.assertExecutionId(input.companyId);
    return this.service.assignFile(executionId, fileId, input, request.requestId, identityFromRequest(request));
  }

  @Get()
  list(@Query() input: ListPaymentNotificationsDto): Promise<ListPaymentNotificationsResponse> {
    return this.service.list(input);
  }

  // PN1.2 targeting fix (§4/§9): reprocess is per-execution — the caller identifies the row by
  // its public executionId (same identifier and validation as GET/:executionId below), never by
  // an internal correo_id. No request body: correo_id is resolved entirely server-side from
  // executionId and never accepted from, or returned to, the browser.
  @Post(':executionId/reprocess')
  @HttpCode(202)
  async reprocess(@Param('executionId') executionId: string, @Req() request: AuthenticatedRequest): Promise<{ status: 'TRIGGERED' }> {
    this.assertExecutionId(executionId);
    const result = await this.service.reprocess(executionId, request.requestId, identityFromRequest(request));
    if (result.status === 'NOT_FOUND') throw new NotFoundException('Ejecución de notificaciones de pago no encontrada.');
    if (result.status === 'NOT_ELIGIBLE') throw new ConflictException('Esta ejecución ya no es elegible para reproceso.');
    if (result.status === 'UPSTREAM_ERROR') throw new BadGatewayException('No se pudo iniciar el reproceso en este momento.');
    return result;
  }

  @Get(':executionId')
  getDetail(@Param('executionId') executionId: string): Promise<PaymentNotificationExecutionDetailResponse> {
    this.assertExecutionId(executionId);
    return this.service.getDetail(executionId);
  }

  // BIGINT-safe: validated as a digit string and range-checked against int8 max, never coerced
  // through Number()/ParseIntPipe, so an executionId beyond Number.MAX_SAFE_INTEGER is never
  // silently truncated (Phase 10B §5). Mirrors AddressesController.assertId.
  private assertExecutionId(executionId: string): void {
    if (!/^[1-9]\d*$/.test(executionId) || BigInt(executionId) > 9223372036854775807n) {
      throw new BadRequestException('El identificador de la ejecución debe ser un entero positivo.');
    }
  }
}
