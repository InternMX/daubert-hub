import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ContactMethodsController } from './contact-methods.controller';
import { ContactMethodsRepository } from './contact-methods.repository';
import { ContactMethodsService } from './contact-methods.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ContactMethodsController],
  providers: [ContactMethodsRepository, ContactMethodsService]
})
export class ContactMethodsModule {}
