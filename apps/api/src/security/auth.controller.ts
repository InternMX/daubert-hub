import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { clearSessionCookie, COOKIE_SECURITY_CONFIG, readSessionCookie, setSessionCookie, type CookieSecurityConfig } from './session-cookie';
import type { SafeUser } from './users.types';

interface UserResponse {
  data: { user: SafeUser };
}

const NOT_AUTHENTICATED_MESSAGE = 'No autenticado.';

// No AuthGuard/RolesGuard here yet (later phase) — these three routes are
// this phase's entire HTTP surface, and every other existing route remains
// exactly as before.
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(COOKIE_SECURITY_CONFIG) private readonly cookieConfig: CookieSecurityConfig
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() input: LoginDto, @Res({ passthrough: true }) response: Response): Promise<UserResponse> {
    const result = await this.auth.login(input.email, input.password);
    setSessionCookie(response, result.token, this.cookieConfig);
    return { data: { user: result.user } };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<{ data: { success: true } }> {
    const token = readSessionCookie(request);
    if (token) await this.auth.logout(token);
    // Always cleared, regardless of whether a session existed — logout
    // never reveals session existence and is safe to call repeatedly.
    clearSessionCookie(response, this.cookieConfig);
    return { data: { success: true } };
  }

  @Get('me')
  async me(@Req() request: Request): Promise<UserResponse> {
    const token = readSessionCookie(request);
    const user = token ? await this.auth.getUserForToken(token) : null;
    if (!user) throw new UnauthorizedException(NOT_AUTHENTICATED_MESSAGE);
    return { data: { user } };
  }
}
