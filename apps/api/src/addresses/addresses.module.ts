import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AddressesController } from './addresses.controller';
import { AddressesRepository } from './addresses.repository';
import { AddressesService } from './addresses.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AddressesController],
  providers: [AddressesRepository, AddressesService]
})
export class AddressesModule {}
