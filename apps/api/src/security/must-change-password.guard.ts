import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../common/authenticated-request';
import { ALLOW_WHILE_PASSWORD_CHANGE_REQUIRED_KEY } from './route-access.decorators';

const PASSWORD_CHANGE_REQUIRED_MESSAGE = 'Debes cambiar tu contraseña antes de continuar.';

// Deliberately a second, small guard rather than folded into AuthGuard:
// authentication ("who is this?") and password-state policy ("are they
// allowed to do this yet?") are different concerns. Runs after AuthGuard
// (registration order in AppModule), so request.user is already populated
// for any route that reached this point — a route with no request.user is
// either @Public() (nothing to enforce) or would already have been
// rejected by AuthGuard, so this guard passes it through either way.
//
// 403, not 401: the session IS valid and the caller IS who they say they
// are — this is an authorization/policy rejection, not an authentication
// failure, and a distinct `code` lets a future frontend route the user to
// "change your password" rather than "log in again".
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user || request.user.mustChangePassword !== true) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_WHILE_PASSWORD_CHANGE_REQUIRED_KEY, [context.getHandler(), context.getClass()]);
    if (allowed) return true;

    throw new ForbiddenException({ code: 'PASSWORD_CHANGE_REQUIRED', message: PASSWORD_CHANGE_REQUIRED_MESSAGE });
  }
}
