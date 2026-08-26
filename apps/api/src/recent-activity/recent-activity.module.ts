import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PaymentNotificationActivityRepository } from './payment-notification-activity.repository';
import { RecentActivityController } from './recent-activity.controller';
import { RecentActivityRepository } from './recent-activity.repository';
import { RecentActivityService } from './recent-activity.service';

@Module({
  imports: [DatabaseModule],
  controllers: [RecentActivityController],
  providers: [RecentActivityRepository, PaymentNotificationActivityRepository, RecentActivityService]
})
export class RecentActivityModule {}
