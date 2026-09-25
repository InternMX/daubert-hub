import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PaymentNotificationSettingsController } from './payment-notification-settings.controller';
import { PaymentNotificationSettingsRepository } from './payment-notification-settings.repository';
import { PaymentNotificationSettingsService } from './payment-notification-settings.service';

@Module({
  imports: [DatabaseModule],
  controllers: [PaymentNotificationSettingsController],
  providers: [PaymentNotificationSettingsRepository, PaymentNotificationSettingsService]
})
export class PaymentNotificationSettingsModule {}
