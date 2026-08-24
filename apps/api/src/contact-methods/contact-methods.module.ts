import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ContactMethodsController, ContactMethodsForContactsController } from './contact-methods.controller';
import { ContactMethodsRepository } from './contact-methods.repository';
import { ContactMethodsService } from './contact-methods.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ContactMethodsController, ContactMethodsForContactsController],
  providers: [ContactMethodsRepository, ContactMethodsService]
})
export class ContactMethodsModule {}
