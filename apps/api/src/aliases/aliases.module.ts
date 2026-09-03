import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AliasesController } from './aliases.controller';
import { AliasesRepository } from './aliases.repository';
import { AliasesService } from './aliases.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AliasesController],
  providers: [AliasesRepository, AliasesService]
})
export class AliasesModule {}
