import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../common/authenticated-request';
import { IS_PUBLIC_KEY } from './route-access.decorators';
import { readSessionCookie } from './session-cookie';
import { SessionsService } from './sessions.service';

const NOT_AUTHENTICATED_MESSAGE = 'No autenticado.';

// Global, secure-by-default guard (registered via APP_GUARD in AppModule):
// every route requires a valid session unless explicitly @Public(). Reuses
// the exact Phase 3 session resolution (SessionsService.resolveActiveSession
// already re-validates revocation, expiry, and ACTIVE user status against
// PostgreSQL on every call) — no authentication logic is duplicated here.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionsService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readSessionCookie(request);
    const active = token ? await this.sessions.resolveActiveSession(token) : null;
    if (!active) throw new UnauthorizedException(NOT_AUTHENTICATED_MESSAGE);

    request.user = active.user;
    return true;
  }
}
