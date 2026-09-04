import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthGuard } from '../src/security/auth.guard';
import { IS_PUBLIC_KEY } from '../src/security/route-access.decorators';

const safeUser = { id: '42', displayName: 'Ana', email: 'ana@example.test', role: 'GENERAL', status: 'ACTIVE', mustChangePassword: false, createdAt: 'x', updatedAt: 'x', lastLoginAt: null };

function context(request: unknown, isPublic: boolean, reflectorSpy?: ReturnType<typeof vi.fn>) {
  const getAllAndOverride = reflectorSpy ?? vi.fn().mockReturnValue(isPublic);
  const reflector = { getAllAndOverride };
  const executionContext = {
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({ getRequest: () => request })
  } as unknown as ExecutionContext;
  return { reflector, executionContext };
}

describe('AuthGuard', () => {
  it('allows a route marked @Public() without checking any session', async () => {
    const sessions = { resolveActiveSession: vi.fn() };
    const { reflector, executionContext } = context({ headers: {} }, true);
    const guard = new AuthGuard(reflector as never, sessions as never);

    await expect(guard.canActivate(executionContext)).resolves.toBe(true);
    expect(sessions.resolveActiveSession).not.toHaveBeenCalled();
  });

  it('reads @Public() metadata from both the handler and the controller class', async () => {
    const sessions = { resolveActiveSession: vi.fn() };
    const spy = vi.fn().mockReturnValue(true);
    const { reflector, executionContext } = context({ headers: {} }, true, spy);
    const guard = new AuthGuard(reflector as never, sessions as never);

    await guard.canActivate(executionContext);
    expect(spy).toHaveBeenCalledWith(IS_PUBLIC_KEY, ['handler', 'class']);
  });

  it('rejects with 401 when there is no session cookie at all', async () => {
    const sessions = { resolveActiveSession: vi.fn() };
    const { reflector, executionContext } = context({ headers: {} }, false);
    const guard = new AuthGuard(reflector as never, sessions as never);

    await expect(guard.canActivate(executionContext)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sessions.resolveActiveSession).not.toHaveBeenCalled();
  });

  it('attaches the resolved safe user to request.user on a valid session', async () => {
    const sessions = { resolveActiveSession: vi.fn().mockResolvedValue({ sessionId: '1', user: safeUser }) };
    const request: { headers: { cookie: string }; user?: unknown } = { headers: { cookie: 'daubert_session=raw-token' } };
    const { reflector, executionContext } = context(request, false);
    const guard = new AuthGuard(reflector as never, sessions as never);

    await expect(guard.canActivate(executionContext)).resolves.toBe(true);
    expect(sessions.resolveActiveSession).toHaveBeenCalledWith('raw-token');
    expect(request.user).toEqual(safeUser);
  });

  it.each([
    ['expired session', null],
    ['revoked session', null],
    ['inactive user (excluded by the same resolveActiveSession JOIN)', null]
  ])('rejects with 401 for %s', async (_scenario, resolved) => {
    const sessions = { resolveActiveSession: vi.fn().mockResolvedValue(resolved) };
    const request = { headers: { cookie: 'daubert_session=raw-token' } };
    const { reflector, executionContext } = context(request, false);
    const guard = new AuthGuard(reflector as never, sessions as never);

    await expect(guard.canActivate(executionContext)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
