import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { DocumentSeriesRepository } from './document-series.repository';
import { PaymentNotificationsController } from './payment-notifications/payment-notifications.controller';
import { PaymentNotificationsRepository } from './payment-notifications/payment-notifications.repository';
import { PaymentNotificationsService } from './payment-notifications/payment-notifications.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AutomationsController, PaymentNotificationsController],
  providers: [AutomationsService, DocumentSeriesRepository, PaymentNotificationsService, PaymentNotificationsRepository]
})
export class AutomationsModule {}
