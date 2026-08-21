import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ProvidersController } from './providers.controller';
import { ProvidersRepository } from './providers.repository';
import { ProvidersService } from './providers.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ProvidersController],
  providers: [ProvidersRepository, ProvidersService]
})
export class ProvidersModule {}
