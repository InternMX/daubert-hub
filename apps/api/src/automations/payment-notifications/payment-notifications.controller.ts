import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { ListPaymentNotificationsDto } from './dto/list-payment-notifications.dto';
import { PaymentNotificationsService, type ListPaymentNotificationsResponse, type PaymentNotificationExecutionDetailResponse } from './payment-notifications.service';

// No @Roles(...): this is a read-only operational module open to both GENERAL and ADMIN,
// same as every other route in this app with no explicit role restriction (see RolesGuard).
@Controller('automations/payment-notifications')
export class PaymentNotificationsController {
  constructor(private readonly service: PaymentNotificationsService) {}

  @Get()
  list(@Query() input: ListPaymentNotificationsDto): Promise<ListPaymentNotificationsResponse> {
    return this.service.list(input);
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
