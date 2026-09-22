import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DocumentSeriesActivityRepository } from './document-series-activity.repository';
import { PaymentNotificationActivityRepository } from './payment-notification-activity.repository';
import { RecentActivityController } from './recent-activity.controller';
import { RecentActivityRepository } from './recent-activity.repository';
import { RecentActivityService } from './recent-activity.service';
import { RemisionesAudiActivityRepository } from './remisiones-audi-activity.repository';
import { RemisionesCaterpillarActivityRepository } from './remisiones-caterpillar-activity.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [RecentActivityController],
  providers: [RecentActivityRepository, PaymentNotificationActivityRepository, RemisionesAudiActivityRepository, RemisionesCaterpillarActivityRepository, DocumentSeriesActivityRepository, RecentActivityService]
})
export class RecentActivityModule {}
