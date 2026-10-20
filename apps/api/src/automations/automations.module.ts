import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { HealthModule } from '../health/health.module';
import { AliasesModule } from '../aliases/aliases.module';
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
import { PaymentFileAssignmentsRepository } from './payment-notifications/payment-file-assignments.repository';
import { PaymentFileAssignmentsService } from './payment-notifications/payment-file-assignments.service';
import { AudiExecutionsController } from './remisiones-audi/audi-executions.controller';
import { AudiExecutionsRepository } from './remisiones-audi/audi-executions.repository';
import { AudiExecutionsService } from './remisiones-audi/audi-executions.service';
import { CaterpillarController } from './remisiones-caterpillar/caterpillar.controller';
import { CaterpillarExecutionsRepository } from './remisiones-caterpillar/caterpillar-executions.repository';
import { CaterpillarExecutionsService } from './remisiones-caterpillar/caterpillar-executions.service';
import { CaterpillarReprocessWebhookClient } from './remisiones-caterpillar/caterpillar-reprocess-webhook.client';
import { CaterpillarRoutingRepository } from './remisiones-caterpillar/caterpillar-routing.repository';
import { CaterpillarRoutingService } from './remisiones-caterpillar/caterpillar-routing.service';
import { ReviewAcknowledgementsController } from './review/review-acknowledgements.controller';
import { ReviewAcknowledgementsRepository } from './review/review-acknowledgements.repository';
import { ReviewAcknowledgementsService } from './review/review-acknowledgements.service';
import { AutomationTriggerRequestsRepository } from './trigger-requests/automation-trigger-requests.repository';

@Module({
  imports: [DatabaseModule, HealthModule, AliasesModule],
  controllers: [AutomationsController, PaymentNotificationsController, AutomationsOverviewController, AudiExecutionsController, CaterpillarController, ReviewAcknowledgementsController],
  providers: [
    AutomationsService, DocumentSeriesRepository,
    PaymentNotificationsService, PaymentNotificationsRepository, PaymentNotificationsWebhookClient,
    PaymentFileAssignmentsRepository, PaymentFileAssignmentsService,
    AutomationsOverviewService, AutomationsOverviewRepository,
    AudiExecutionsService, AudiExecutionsRepository,
    CaterpillarExecutionsService, CaterpillarExecutionsRepository, CaterpillarReprocessWebhookClient,
    CaterpillarRoutingService, CaterpillarRoutingRepository,
    ReviewAcknowledgementsService, ReviewAcknowledgementsRepository,
    AutomationTriggerRequestsRepository
  ]
})
export class AutomationsModule {}
