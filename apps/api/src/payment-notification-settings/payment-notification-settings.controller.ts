import { BadRequestException, Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';
import { identityFromRequest, type AuthenticatedRequest } from '../common/authenticated-request';
import { UpdatePaymentNotificationSettingsDto } from './dto/update-payment-notification-settings.dto';
import { PaymentNotificationSettingsService, type PaymentNotificationSettingsResponse } from './payment-notification-settings.service';

@Controller('companies/:companyId/payment-notification-settings')
export class PaymentNotificationSettingsController {
  constructor(private readonly settings: PaymentNotificationSettingsService) {}

  @Get()
  get(@Param('companyId') companyId: string): Promise<PaymentNotificationSettingsResponse> {
    this.assertId(companyId);
    return this.settings.get(companyId);
  }

  @Patch()
  update(@Param('companyId') companyId: string, @Body() input: UpdatePaymentNotificationSettingsDto, @Req() request: AuthenticatedRequest): Promise<PaymentNotificationSettingsResponse> {
    this.assertId(companyId);
    return this.settings.update(companyId, input, request.requestId, identityFromRequest(request));
  }

  private assertId(id: string): void {
    if (!/^[1-9]\d*$/.test(id) || BigInt(id) > 9223372036854775807n) {
      throw new BadRequestException('El identificador de la empresa debe ser un entero positivo.');
    }
  }
}
