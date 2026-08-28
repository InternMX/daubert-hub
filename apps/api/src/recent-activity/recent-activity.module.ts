import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PaymentNotificationActivityRepository } from './payment-notification-activity.repository';
import { RecentActivityController } from './recent-activity.controller';
import { RecentActivityRepository } from './recent-activity.repository';
import { RecentActivityService } from './recent-activity.service';
import { RemisionesAudiActivityRepository } from './remisiones-audi-activity.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [RecentActivityController],
  providers: [RecentActivityRepository, PaymentNotificationActivityRepository, RemisionesAudiActivityRepository, RecentActivityService]
})
export class RecentActivityModule {}
