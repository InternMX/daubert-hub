import { describe, expect, it, vi } from 'vitest';
import { SESSION_LIFETIME_MS, SessionsService } from '../src/security/sessions.service';
import { hashSessionToken } from '../src/security/session-token';

function setup() {
  const repository = { create: vi.fn(), findActiveByTokenHash: vi.fn(), revoke: vi.fn(), revokeAllForUser: vi.fn() };
  const service = new SessionsService(repository as never);
  return { service, repository };
}

describe('SessionsService', () => {
  it('creates a session with a 12-hour absolute expiry and persists only the token hash', async () => {
    const { service, repository } = setup();
    repository.create.mockResolvedValue({ sessionId: '1' });
    const before = Date.now();

    const issued = await service.createSession('42');

    expect(SESSION_LIFETIME_MS).toBe(12 * 60 * 60 * 1000);
    expect(repository.create).toHaveBeenCalledTimes(1);
    const [userId, tokenHash, expiresAt] = repository.create.mock.calls[0] as [string, string, Date];
    expect(userId).toBe('42');
    expect(tokenHash).toBe(hashSessionToken(issued.token));
    expect(tokenHash).not.toBe(issued.token);
    expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(SESSION_LIFETIME_MS - 1000);
    expect(expiresAt.getTime() - before).toBeLessThanOrEqual(SESSION_LIFETIME_MS + 5000);
    expect(issued.expiresAt).toBe(expiresAt);
  });

  it('resolves an active session by hashing the raw token before lookup', async () => {
    const { service, repository } = setup();
    repository.findActiveByTokenHash.mockResolvedValue({ sessionId: '1', user: { id: '42' } });
    const result = await service.resolveActiveSession('raw-token-value');
    expect(repository.findActiveByTokenHash).toHaveBeenCalledWith(hashSessionToken('raw-token-value'));
    expect(result).toEqual({ sessionId: '1', user: { id: '42' } });
  });

  it('returns null for an expired/revoked/unknown token (repository finds nothing)', async () => {
    const { service, repository } = setup();
    repository.findActiveByTokenHash.mockResolvedValue(null);
    await expect(service.resolveActiveSession('anything')).resolves.toBeNull();
  });

  it('returns null when the session user is no longer ACTIVE (repository finds nothing, by its own JOIN condition)', async () => {
    const { service, repository } = setup();
    repository.findActiveByTokenHash.mockResolvedValue(null);
    await expect(service.resolveActiveSession('inactive-user-token')).resolves.toBeNull();
  });

  it('revokeByToken revokes the resolved active session', async () => {
    const { service, repository } = setup();
    repository.findActiveByTokenHash.mockResolvedValue({ sessionId: '7', user: {} });
    await service.revokeByToken('raw-token');
    expect(repository.revoke).toHaveBeenCalledWith('7');
  });

  it('revokeByToken is a safe no-op (idempotent) when the token does not resolve to an active session', async () => {
    const { service, repository } = setup();
    repository.findActiveByTokenHash.mockResolvedValue(null);
    await expect(service.revokeByToken('already-revoked-or-unknown')).resolves.toBeUndefined();
    expect(repository.revoke).not.toHaveBeenCalled();
  });

  it('revokeAllForUser delegates directly to the repository', async () => {
    const { service, repository } = setup();
    await service.revokeAllForUser('42');
    expect(repository.revokeAllForUser).toHaveBeenCalledWith('42');
  });
});
