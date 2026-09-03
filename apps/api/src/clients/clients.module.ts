import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ClientsController } from './clients.controller';
import { ClientsRepository } from './clients.repository';
import { ClientsService } from './clients.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ClientsController],
  providers: [ClientsRepository, ClientsService]
})
export class ClientsModule {}