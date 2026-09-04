import { describe, expect, it, vi } from 'vitest';
import { SessionsRepository } from '../src/security/sessions.repository';

const rawRow = {
  session_id: '5',
  user_id: '9007199254740993123',
  display_name: 'Ana Admin',
  email: 'ana@example.test',
  role: 'ADMIN',
  status: 'ACTIVE',
  must_change_password: false,
  created_at: '2026-09-05T10:00:00.000Z',
  updated_at: '2026-09-05T10:00:00.000Z',
  last_login_at: '2026-09-05T10:05:00.000Z'
};

describe('SessionsRepository', () => {
  it('creates a session and returns a BIGINT-safe string session id', async () => {
    const query = vi.fn().mockResolvedValue([{ session_id: '9223372036854775807' }]);
    const repository = new SessionsRepository({ query } as never);

    const result = await repository.create('1', 'tokenhash', new Date('2026-09-05T22:00:00.000Z'));

    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO security.sessions'), ['1', 'tokenhash', '2026-09-05T22:00:00.000Z']);
    expect(result).toEqual({ sessionId: '9223372036854775807' });
    expect(typeof result.sessionId).toBe('string');
  });

  it('resolves an active session joined with its user, requiring not-revoked/not-expired/ACTIVE user in one query', async () => {
    const query = vi.fn().mockResolvedValue([rawRow]);
    const repository = new SessionsRepository({ query } as never);

    const result = await repository.findActiveByTokenHash('somehash');

    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain('s.revoked_at IS NULL');
    expect(sql).toContain('s.expires_at > now()');
    expect(sql).toContain("u.status = 'ACTIVE'");
    expect(result).toEqual({
      sessionId: '5',
      user: {
        id: '9007199254740993123',
        displayName: 'Ana Admin',
        email: 'ana@example.test',
        role: 'ADMIN',
        status: 'ACTIVE',
        mustChangePassword: false,
        createdAt: rawRow.created_at,
        updatedAt: rawRow.updated_at,
        lastLoginAt: rawRow.last_login_at
      }
    });
    expect(result?.user).not.toHaveProperty('passwordHash');
  });

  it('returns null when no row matches (revoked, expired, inactive user, or unknown hash)', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const repository = new SessionsRepository({ query } as never);
    await expect(repository.findActiveByTokenHash('missing')).resolves.toBeNull();
  });

  it('revokes a session by id, only if not already revoked', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const repository = new SessionsRepository({ query } as never);
    await repository.revoke('5');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('SET revoked_at = now()'), ['5']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('revoked_at IS NULL'), ['5']);
  });

  it('revokes all active sessions for a user', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const repository = new SessionsRepository({ query } as never);
    await repository.revokeAllForUser('1');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE user_id = $1 AND revoked_at IS NULL'), ['1']);
  });
});
