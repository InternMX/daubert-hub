import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { identityFromRequest, type AuthenticatedRequest } from '../common/authenticated-request';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { AllowWhilePasswordChangeRequired, Public } from './route-access.decorators';
import { clearSessionCookie, COOKIE_SECURITY_CONFIG, readSessionCookie, setSessionCookie, type CookieSecurityConfig } from './session-cookie';
import type { SafeUser } from './users.types';

interface UserResponse {
  data: { user: SafeUser };
}

const NOT_AUTHENTICATED_MESSAGE = 'No autenticado.';

// login/logout are @Public() (no session exists yet / logout must stay
// idempotent even without one). me and change-password require the global
// AuthGuard's request.user, and are explicitly allowed while
// mustChangePassword=true (see MustChangePasswordGuard) since they are
// exactly the routes that make satisfying that requirement possible.
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(COOKIE_SECURITY_CONFIG) private readonly cookieConfig: CookieSecurityConfig
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() input: LoginDto, @Res({ passthrough: true }) response: Response): Promise<UserResponse> {
    const result = await this.auth.login(input.email, input.password);
    setSessionCookie(response, result.token, this.cookieConfig);
    return { data: { user: result.user } };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response): Promise<{ data: { success: true } }> {
    const token = readSessionCookie(request);
    if (token) await this.auth.logout(token);
    // Always cleared, regardless of whether a session existed — logout
    // never reveals session existence and is safe to call repeatedly.
    clearSessionCookie(response, this.cookieConfig);
    return { data: { success: true } };
  }

  // AuthGuard already resolved and attached request.user for this request —
  // re-authenticating the same cookie a second time here would be pure
  // duplication of Phase 3 logic.
  @AllowWhilePasswordChangeRequired()
  @Get('me')
  me(@Req() request: AuthenticatedRequest): UserResponse {
    if (!request.user) throw new UnauthorizedException(NOT_AUTHENTICATED_MESSAGE);
    return { data: { user: request.user } };
  }

  @AllowWhilePasswordChangeRequired()
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(@Body() input: ChangePasswordDto, @Req() request: AuthenticatedRequest): Promise<UserResponse> {
    if (!request.user) throw new UnauthorizedException(NOT_AUTHENTICATED_MESSAGE);
    const identity = identityFromRequest(request);
    const user = await this.auth.changePassword(request.user.id, input.currentPassword, input.newPassword, identity);
    return { data: { user } };
  }
}
