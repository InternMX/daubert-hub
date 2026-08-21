import { Module } from '@nestjs/common';
import { ContactDirectoryController } from './contact-directory.controller';
import { ContactDirectoryRepository } from './contact-directory.repository';
import { ContactDirectoryService } from './contact-directory.service';

@Module({ controllers: [ContactDirectoryController], providers: [ContactDirectoryService, ContactDirectoryRepository] })
export class ContactDirectoryModule {}
