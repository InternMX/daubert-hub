import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../common/authenticated-request';
import { ROLES_KEY } from './route-access.decorators';
import type { UserRole } from './users.types';

const NOT_AUTHENTICATED_MESSAGE = 'No autenticado.';
const ROLE_NOT_ALLOWED_MESSAGE = 'No tienes permisos suficientes para realizar esta acción.';

// Global (registered via APP_GUARD in AppModule, after AuthGuard and
// MustChangePasswordGuard — see that module for the exact ordering
// rationale): enforces role authorization ONLY when a route/controller
// explicitly declares @Roles(...). Every existing authenticated route with no
// @Roles() metadata stays open to both ADMIN and GENERAL, unchanged from
// Phase 1-5 — this guard is additive, not a new default restriction.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // Defensive only: by the time a non-@Public() route reaches this guard,
    // AuthGuard has already populated request.user or rejected the request
    // with 401. A missing request.user here means authentication itself
    // never happened — that is a 401, not a role/authorization failure.
    if (!request.user) throw new UnauthorizedException(NOT_AUTHENTICATED_MESSAGE);

    if (!requiredRoles.includes(request.user.role)) {
      throw new ForbiddenException({ code: 'ROLE_NOT_ALLOWED', message: ROLE_NOT_ALLOWED_MESSAGE });
    }
    return true;
  }
}
