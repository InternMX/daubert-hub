import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ContactsController } from './contacts.controller';
import { ContactsRepository } from './contacts.repository';
import { ContactsService } from './contacts.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ContactsController],
  providers: [ContactsRepository, ContactsService]
})
export class ContactsModule {}
