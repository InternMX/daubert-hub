import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/environment';
import { AuthGuard } from './security/auth.guard';
import { MustChangePasswordGuard } from './security/must-change-password.guard';
import { RolesGuard } from './security/roles.guard';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { ProvidersModule } from './providers/providers.module';
import { ContactDirectoryModule } from './contact-directory/contact-directory.module';
import { ContactsModule } from './contacts/contacts.module';
import { CompaniesModule } from './companies/companies.module';
import { ContactMethodsModule } from './contact-methods/contact-methods.module';
import { ClientsModule } from './clients/clients.module';
import { RecentActivityModule } from './recent-activity/recent-activity.module';
import { AutomationsModule } from './automations/automations.module';
import { AddressesModule } from './addresses/addresses.module';
import { AliasesModule } from './aliases/aliases.module';
import { SecurityModule } from './security/security.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['apps/api/.env', '.env'], validate: validateEnvironment }),
    DatabaseModule,
    HealthModule,
    ProvidersModule,
    ContactDirectoryModule,
    ContactsModule,
    CompaniesModule,
    ContactMethodsModule,
    RecentActivityModule,
    AutomationsModule,
    AddressesModule,
    AliasesModule,
    ClientsModule,
    SecurityModule
  ],
  providers: [
    // Order matters: AuthGuard (authentication) must run before
    // MustChangePasswordGuard (password-state policy), which must run before
    // RolesGuard (role authorization) — each guard depends on request.user
    // (AuthGuard) or the previous guard's policy check already having
    // passed. Nest applies multiple APP_GUARD providers in this registration
    // order.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: MustChangePasswordGuard },
    { provide: APP_GUARD, useClass: RolesGuard }
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('{*splat}');
  }
}
