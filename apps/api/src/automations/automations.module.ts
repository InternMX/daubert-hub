import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { DocumentSeriesRepository } from './document-series.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [AutomationsController],
  providers: [AutomationsService, DocumentSeriesRepository]
})
export class AutomationsModule {}
