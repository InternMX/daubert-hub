import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { ProvidersModule } from './providers/providers.module';
import { ContactDirectoryModule } from './contact-directory/contact-directory.module';
import { ContactsModule } from './contacts/contacts.module';
import { CompaniesModule } from './companies/companies.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['apps/api/.env', '.env'], validate: validateEnvironment }),
    DatabaseModule,
    HealthModule,
    ProvidersModule,
    ContactDirectoryModule,
    ContactsModule,
    CompaniesModule
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('{*splat}');
  }
}
