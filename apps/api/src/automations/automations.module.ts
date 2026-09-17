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
import { PaymentNotificationsWebhookClient } from './payment-notifications/payment-notifications-webhook.client';
import { AudiExecutionsController } from './remisiones-audi/audi-executions.controller';
import { AudiExecutionsRepository } from './remisiones-audi/audi-executions.repository';
import { AudiExecutionsService } from './remisiones-audi/audi-executions.service';
import { ReviewAcknowledgementsController } from './review/review-acknowledgements.controller';
import { ReviewAcknowledgementsRepository } from './review/review-acknowledgements.repository';
import { ReviewAcknowledgementsService } from './review/review-acknowledgements.service';
import { AutomationTriggerRequestsRepository } from './trigger-requests/automation-trigger-requests.repository';

@Module({
  imports: [DatabaseModule, HealthModule],
  controllers: [AutomationsController, PaymentNotificationsController, AutomationsOverviewController, AudiExecutionsController, ReviewAcknowledgementsController],
  providers: [
    AutomationsService, DocumentSeriesRepository,
    PaymentNotificationsService, PaymentNotificationsRepository, PaymentNotificationsWebhookClient,
    AutomationsOverviewService, AutomationsOverviewRepository,
    AudiExecutionsService, AudiExecutionsRepository,
    ReviewAcknowledgementsService, ReviewAcknowledgementsRepository,
    AutomationTriggerRequestsRepository
  ]
})
export class AutomationsModule {}
