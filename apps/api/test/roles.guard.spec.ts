import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { RolesGuard } from '../src/security/roles.guard';
import { ROLES_KEY } from '../src/security/route-access.decorators';

function context(request: unknown, requiredRoles: string[] | undefined) {
  const getAllAndOverride = vi.fn().mockReturnValue(requiredRoles);
  const reflector = { getAllAndOverride };
  const executionContext = {
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({ getRequest: () => request })
  } as unknown as ExecutionContext;
  return { reflector, executionContext, getAllAndOverride };
}

const admin = { id: '1', displayName: 'Ana Admin', email: 'ana@example.test', role: 'ADMIN', status: 'ACTIVE', mustChangePassword: false };
const general = { id: '2', displayName: 'Gen User', email: 'gen@example.test', role: 'GENERAL', status: 'ACTIVE', mustChangePassword: false };

describe('RolesGuard', () => {
  it('reads role metadata from both the handler and the controller class', () => {
    const { reflector, executionContext, getAllAndOverride } = context({ user: admin }, undefined);
    const guard = new RolesGuard(reflector as never);

    guard.canActivate(executionContext);
    expect(getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, ['handler', 'class']);
  });

  it('allows an ADMIN through a route with no @Roles() metadata', () => {
    const { reflector, executionContext } = context({ user: admin }, undefined);
    const guard = new RolesGuard(reflector as never);
    expect(guard.canActivate(executionContext)).toBe(true);
  });

  it('allows a GENERAL through a route with no @Roles() metadata', () => {
    const { reflector, executionContext } = context({ user: general }, undefined);
    const guard = new RolesGuard(reflector as never);
    expect(guard.canActivate(executionContext)).toBe(true);
  });

  it('allows an ADMIN through a route requiring @Roles(\'ADMIN\')', () => {
    const { reflector, executionContext } = context({ user: admin }, ['ADMIN']);
    const guard = new RolesGuard(reflector as never);
    expect(guard.canActivate(executionContext)).toBe(true);
  });

  it('rejects a GENERAL from a route requiring @Roles(\'ADMIN\') with 403, not 401', () => {
    const { reflector, executionContext } = context({ user: general }, ['ADMIN']);
    const guard = new RolesGuard(reflector as never);

    expect(() => guard.canActivate(executionContext)).toThrow(ForbiddenException);
    try {
      guard.canActivate(executionContext);
      expect.unreachable();
    } catch (error) {
      expect((error as ForbiddenException).getStatus()).toBe(403);
      expect((error as ForbiddenException).getResponse()).toMatchObject({ code: 'ROLE_NOT_ALLOWED' });
    }
  });

  it('fails safely with 401 (not 403) when @Roles() is set but request.user is missing', () => {
    const { reflector, executionContext } = context({}, ['ADMIN']);
    const guard = new RolesGuard(reflector as never);

    expect(() => guard.canActivate(executionContext)).toThrow(UnauthorizedException);
  });

  it('treats an empty @Roles() list the same as no metadata at all', () => {
    const { reflector, executionContext } = context({ user: general }, []);
    const guard = new RolesGuard(reflector as never);
    expect(guard.canActivate(executionContext)).toBe(true);
  });
});
