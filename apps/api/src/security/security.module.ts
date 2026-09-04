import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import type { EnvironmentConfig } from '../config/environment';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { COOKIE_SECURITY_CONFIG, type CookieSecurityConfig } from './session-cookie';
import { SessionsRepository } from './sessions.repository';
import { SessionsService } from './sessions.service';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

// AppModule registers AuthGuard and MustChangePasswordGuard globally.
// Role-based ADMIN/GENERAL authorization remains intentionally out of scope.
@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [
    PasswordService,
    UsersRepository,
    UsersService,
    SessionsRepository,
    SessionsService,
    AuthService,
    {
      provide: COOKIE_SECURITY_CONFIG,
      useFactory: (config: ConfigService<EnvironmentConfig, true>): CookieSecurityConfig => ({
        secure: config.get('auth', { infer: true }).cookieSecure
      }),
      inject: [ConfigService]
    }
  ],
  exports: [PasswordService, UsersRepository, UsersService, SessionsRepository, SessionsService, AuthService]
})
export class SecurityModule {}
