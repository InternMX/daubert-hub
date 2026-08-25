import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RecentActivityController } from './recent-activity.controller';
import { RecentActivityRepository } from './recent-activity.repository';
import { RecentActivityService } from './recent-activity.service';

@Module({
  imports: [DatabaseModule],
  controllers: [RecentActivityController],
  providers: [RecentActivityRepository, RecentActivityService]
})
export class RecentActivityModule {}
