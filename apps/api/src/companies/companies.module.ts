import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CompaniesController } from './companies.controller';
import { CompaniesRepository } from './companies.repository';
import { CompaniesService } from './companies.service';

@Module({ imports: [DatabaseModule], controllers: [CompaniesController], providers: [CompaniesService, CompaniesRepository] })
export class CompaniesModule {}
