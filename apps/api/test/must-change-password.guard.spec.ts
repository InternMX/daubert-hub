import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MustChangePasswordGuard } from '../src/security/must-change-password.guard';
import { ALLOW_WHILE_PASSWORD_CHANGE_REQUIRED_KEY } from '../src/security/route-access.decorators';

function context(request: unknown, allowed: boolean) {
  const getAllAndOverride = vi.fn().mockReturnValue(allowed);
  const reflector = { getAllAndOverride };
  const executionContext = {
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({ getRequest: () => request })
  } as unknown as ExecutionContext;
  return { reflector, executionContext, getAllAndOverride };
}

const user = { id: '42', displayName: 'Ana', email: 'ana@example.test', role: 'GENERAL', status: 'ACTIVE' };

describe('MustChangePasswordGuard', () => {
  it('passes through requests with no request.user (public routes AuthGuard already let through)', () => {
    const { reflector, executionContext, getAllAndOverride } = context({}, false);
    const guard = new MustChangePasswordGuard(reflector as never);

    expect(guard.canActivate(executionContext)).toBe(true);
    expect(getAllAndOverride).not.toHaveBeenCalled();
  });

  it('passes through when mustChangePassword is false, regardless of the allow-list', () => {
    const { reflector, executionContext } = context({ user: { ...user, mustChangePassword: false } }, false);
    const guard = new MustChangePasswordGuard(reflector as never);
    expect(guard.canActivate(executionContext)).toBe(true);
  });

  it('allows the explicitly whitelisted auth routes (me, change-password) while mustChangePassword=true', () => {
    const { reflector, executionContext, getAllAndOverride } = context({ user: { ...user, mustChangePassword: true } }, true);
    const guard = new MustChangePasswordGuard(reflector as never);

    expect(guard.canActivate(executionContext)).toBe(true);
    expect(getAllAndOverride).toHaveBeenCalledWith(ALLOW_WHILE_PASSWORD_CHANGE_REQUIRED_KEY, ['handler', 'class']);
  });

  it('blocks every other (business) route with 403 PASSWORD_CHANGE_REQUIRED while mustChangePassword=true', () => {
    const { reflector, executionContext } = context({ user: { ...user, mustChangePassword: true } }, false);
    const guard = new MustChangePasswordGuard(reflector as never);

    expect(() => guard.canActivate(executionContext)).toThrow(ForbiddenException);
    try {
      guard.canActivate(executionContext);
      expect.unreachable();
    } catch (error) {
      expect((error as ForbiddenException).getStatus()).toBe(403);
      expect((error as ForbiddenException).getResponse()).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
    }
  });
});
