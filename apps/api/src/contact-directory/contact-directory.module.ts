import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ContactDirectoryController } from './contact-directory.controller';
import { ContactDirectoryRepository } from './contact-directory.repository';
import { ContactDirectoryService } from './contact-directory.service';

@Module({ imports: [DatabaseModule], controllers: [ContactDirectoryController], providers: [ContactDirectoryService, ContactDirectoryRepository] })
export class ContactDirectoryModule {}
