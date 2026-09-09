import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { HealthModule } from '../health/health.module';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { DocumentSeriesRepository } from './document-series.repository';
import { AutomationsOverviewController } from './overview/automations-overview.controller';
import { AutomationsOverviewRepository } from './overview/automations-overview.repository';
import { AutomationsOverviewService } from './overview/automations-overview.service';
import { PaymentNotificationsController } from './payment-notifications/payment-notifications.controller';
import { PaymentNotificationsRepository } from './payment-notifications/payment-notifications.repository';
import { PaymentNotificationsService } from './payment-notifications/payment-notifications.service';
import { AudiExecutionsController } from './remisiones-audi/audi-executions.controller';
import { AudiExecutionsRepository } from './remisiones-audi/audi-executions.repository';
import { AudiExecutionsService } from './remisiones-audi/audi-executions.service';

@Module({
  imports: [DatabaseModule, HealthModule],
  controllers: [AutomationsController, PaymentNotificationsController, AutomationsOverviewController, AudiExecutionsController],
  providers: [AutomationsService, DocumentSeriesRepository, PaymentNotificationsService, PaymentNotificationsRepository, AutomationsOverviewService, AutomationsOverviewRepository, AudiExecutionsService, AudiExecutionsRepository]
})
export class AutomationsModule {}
