import { describe, expect, it, vi } from 'vitest';
import { UsersRepository } from '../src/security/users.repository';

const rawRow = {
  user_id: '9007199254740993123',
  display_name: 'Ana Admin',
  email: 'ana@example.test',
  password_hash: '$argon2id$v=19$m=19456,t=2,p=1$salt$hash',
  role: 'ADMIN',
  status: 'ACTIVE',
  must_change_password: true,
  created_at: '2026-09-05T10:00:00.000Z',
  updated_at: '2026-09-05T10:00:00.000Z',
  last_login_at: null
};

const context = { requestId: 'req-1', origin: 'DAUBERT_HUB', actorUserId: null, actorUserEmail: null };

describe('UsersRepository', () => {
  it('finds a user by email using a case-insensitive, trimmed comparison and maps BIGINT id as a string', async () => {
    const query = vi.fn().mockResolvedValue([rawRow]);
    const repository = new UsersRepository({ query } as never);

    const user = await repository.findByEmail('  ANA@Example.TEST  ');

    expect(query).toHaveBeenCalledWith(expect.stringContaining('lower(btrim(email)) = lower(btrim($1))'), ['  ANA@Example.TEST  ']);
    expect(user).toMatchObject({ id: '9007199254740993123', displayName: 'Ana Admin', email: 'ana@example.test', role: 'ADMIN' });
    expect(typeof user?.id).toBe('string');
  });

  it('returns null when no user matches', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const repository = new UsersRepository({ query } as never);
    await expect(repository.findByEmail('missing@example.test')).resolves.toBeNull();
    await expect(repository.findById('1')).resolves.toBeNull();
  });

  it('finds a user by id', async () => {
    const query = vi.fn().mockResolvedValue([rawRow]);
    const repository = new UsersRepository({ query } as never);
    const user = await repository.findById('9007199254740993123');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE user_id = $1'), ['9007199254740993123']);
    expect(user?.id).toBe('9007199254740993123');
  });

  it('creates a user inside a transaction, propagating audit context, and returns the mapped row', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // origin
      .mockResolvedValueOnce(undefined) // request_id
      .mockResolvedValueOnce(undefined) // user_id
      .mockResolvedValueOnce(undefined) // user_email
      .mockResolvedValueOnce({ rows: [rawRow] }) // INSERT ... RETURNING
      .mockResolvedValueOnce(undefined); // COMMIT
    const client = { query, release: vi.fn() };
    const repository = new UsersRepository({ connect: vi.fn().mockResolvedValue(client) } as never);

    const result = await repository.create(
      { displayName: 'Ana Admin', email: 'ana@example.test', passwordHash: 'hash', role: 'ADMIN', status: 'ACTIVE', mustChangePassword: true },
      context
    );

    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(query).toHaveBeenNthCalledWith(2, "SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']);
    expect(query).toHaveBeenNthCalledWith(3, "SELECT set_config('app.request_id', $1, true)", ['req-1']);
    expect(query).toHaveBeenNthCalledWith(4, "SELECT set_config('app.user_id', COALESCE($1, ''), true)", [null]);
    expect(query).toHaveBeenNthCalledWith(5, "SELECT set_config('app.user_email', COALESCE($1, ''), true)", [null]);
    expect(query).toHaveBeenNthCalledWith(7, 'COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
    expect(result.id).toBe('9007199254740993123');
    expect(result.passwordHash).toBe(rawRow.password_hash);
  });

  it('rolls back and releases the client when create fails', async () => {
    const duplicate = { code: '23505', constraint: 'uq_users_email' };
    const query = vi.fn()
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(duplicate)
      .mockResolvedValueOnce(undefined); // ROLLBACK
    const client = { query, release: vi.fn() };
    const repository = new UsersRepository({ connect: vi.fn().mockResolvedValue(client) } as never);

    await expect(repository.create(
      { displayName: 'Ana', email: 'dup@example.test', passwordHash: 'hash', role: 'GENERAL', status: 'ACTIVE', mustChangePassword: true },
      context
    )).rejects.toBe(duplicate);

    expect(query).toHaveBeenNthCalledWith(7, 'ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('updates only the password hash and must_change_password, inside a transaction', async () => {
    const updatedRow = { ...rawRow, password_hash: 'new-hash', must_change_password: false };
    const query = vi.fn()
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [updatedRow] })
      .mockResolvedValueOnce(undefined);
    const client = { query, release: vi.fn() };
    const repository = new UsersRepository({ connect: vi.fn().mockResolvedValue(client) } as never);

    const result = await repository.updatePassword('9007199254740993123', 'new-hash', false, context);

    expect(query).toHaveBeenNthCalledWith(6, expect.stringContaining('SET password_hash = $1, must_change_password = $2'), ['new-hash', false, '9007199254740993123']);
    expect(result?.passwordHash).toBe('new-hash');
    expect(result?.mustChangePassword).toBe(false);
  });

  it('returns null from updatePassword when the user does not exist', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(undefined);
    const client = { query, release: vi.fn() };
    const repository = new UsersRepository({ connect: vi.fn().mockResolvedValue(client) } as never);

    await expect(repository.updatePassword('999', 'new-hash', true, context)).resolves.toBeNull();
  });

  it('lists users ordered by display name, mapping BIGINT ids as strings', async () => {
    const query = vi.fn().mockResolvedValue([rawRow, { ...rawRow, user_id: '2', display_name: 'Beta' }]);
    const repository = new UsersRepository({ query } as never);

    const users = await repository.list();

    expect(query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY display_name ASC'));
    expect(users).toHaveLength(2);
    expect(users.every((user) => typeof user.id === 'string')).toBe(true);
  });

  // Every transactional helper below begins with the same 4 audit-context
  // queries (origin, request_id, user_id, user_email) after BEGIN, and a
  // findByIdForUpdate SELECT ... FOR UPDATE before the actual mutation.

  describe('updateProfile', () => {
    it('updates displayName only and does not revoke sessions', async () => {
      const updatedRow = { ...rawRow, display_name: 'New Name' };
      const query = vi.fn()
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined) // audit context
        .mockResolvedValueOnce({ rows: [rawRow] }) // findByIdForUpdate
        .mockResolvedValueOnce({ rows: [updatedRow] }) // UPDATE ... RETURNING
        .mockResolvedValueOnce(undefined); // COMMIT
      const client = { query, release: vi.fn() };
      const repository = new UsersRepository({ connect: vi.fn().mockResolvedValue(client) } as never);

      const result = await repository.updateProfile('9007199254740993123', { displayName: 'New Name' }, context);

      expect(result?.displayName).toBe('New Name');
      expect(query).toHaveBeenCalledTimes(8);
      expect(query).toHaveBeenNthCalledWith(8, 'COMMIT');
      expect(query.mock.calls.some((call) => String(call[0]).includes('security.sessions'))).toBe(false);
    });

    it('revokes sessions when email changes', async () => {
      const updatedRow = { ...rawRow, email: 'new@example.test' };
      const query = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [rawRow] })
        .mockResolvedValueOnce({ rows: [updatedRow] })
        .mockResolvedValueOnce(undefined) // UPDATE security.sessions
        .mockResolvedValueOnce(undefined); // COMMIT
      const client = { query, release: vi.fn() };
      const repository = new UsersRepository({ connect: vi.fn().mockResolvedValue(client) } as never);

      await repository.updateProfile('9007199254740993123', { email: 'new@example.test' }, context);

      expect(query).toHaveBeenNthCalledWith(8, expect.stringContaining('security.sessions'), ['9007199254740993123']);
    });

    it('revokes sessions when role changes (not demoting the last active admin)', async () => {
      const currentGeneral = { ...rawRow, role: 'GENERAL' };
      const updatedRow = { ...currentGeneral, role: 'ADMIN' };
      const query = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [currentGeneral] })
        .mockResolvedValueOnce({ rows: [updatedRow] })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      const client = { query, release: vi.fn() };
      const repository = new UsersRepository({ connect: vi.fn().mockResolvedValue(client) } as never);

      const result = await repository.updateProfile('9007199254740993123', { role: 'ADMIN' }, context);

      expect(result?.role).toBe('ADMIN');
      expect(query).toHaveBeenNthCalledWith(8, expect.stringContaining('security.sessions'), ['9007199254740993123']);
    });

    it('does not revoke sessions or lock admin rows for a displayName-only change even when the target is an ADMIN', async () => {
      const adminRow = { ...rawRow, role: 'ADMIN', status: 'ACTIVE' };
      const query = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [adminRow] })
        .mockResolvedValueOnce({ rows: [{ ...adminRow, display_name: 'New Name' }] })
        .mockResolvedValueOnce(undefined);
      const client = { query, release: vi.fn() };
      const repository = new UsersRepository({ connect: vi.fn().mockResolvedValue(client) } as never);

      await repository.updateProfile('9007199254740993123', { displayName: 'New Name' }, context);

      expect(query).toHaveBeenCalledTimes(8);
      expect(query.mock.calls.some((call) => String(call[0]).includes("role = 'ADMIN'"))).toBe(false);
    });

    it('rejects demoting the last ACTIVE ADMIN and rolls back without mutating', async () => {
      const lastAdmin = { ...rawRow, role: 'ADMIN', status: 'ACTIVE' };
      const query = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [lastAdmin] }) // findByIdForUpdate
        .mockResolvedValueOnce({ rows: [{ user_id: lastAdmin.user_id }] }) // assertNotLastActiveAdmin: only 1 row
        .mockResolvedValueOnce(undefined); // ROLLBACK
      const client = { query, release: vi.fn() };
      const repository = new UsersRepository({ connect: vi.fn().mockResolvedValue(client) } as never);

      await expect(repository.updateProfile(lastAdmin.user_id, { role: 'GENERAL' }, context)).rejects.toMatchObject({ code: 'LAST_ACTIVE_ADMIN' });
      expect(query).toHaveBeenNthCalledWith(8, 'ROLLBACK');
      expect(client.release).toHaveBeenCalledOnce();
    });

    it('allows demoting an admin when at least one other ACTIVE ADMIN remains', async () => {
      const target = { ...rawRow, role: 'ADMIN', status: 'ACTIVE' };
      const otherAdminId = '2';
      const query = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [target] })
        .mockResolvedValueOnce({ rows: [{ user_id: target.user_id }, { user_id: otherAdminId }] }) // 2 active admins
        .mockResolvedValueOnce({ rows: [{ ...target, role: 'GENERAL' }] })
        .mockResolvedValueOnce(undefined) // revoke sessions
        .mockResolvedValueOnce(undefined); // COMMIT
      const client = { query, release: vi.fn() };
      const repository = new UsersRepository({ connect: vi.fn().mockResolvedValue(client) } as never);

      const result = await repository.updateProfile(target.user_id, { role: 'GENERAL' }, context);
      expect(result?.role).toBe('GENERAL');
    });

    it('returns null when the target does not exist', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce(undefined);
      const client = { query, release: vi.fn() };
      const repository = new UsersRepository({ connect: vi.fn().mockResolvedValue(client) } as never);

      await expect(repository.updateProfile('999', { displayName: 'X' }, context)).resolves.toBeNull();
    });
  });

  describe('deactivate', () => {
    it('sets status INACTIVE and revokes all sessions atomically', async () => {
      const active = { ...rawRow, role: 'GENERAL', status: 'ACTIVE' };
      const query = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [active] })
        .mockResolvedValueOnce({ rows: [{ ...active, status: 'INACTIVE' }] })
        .mockResolvedValueOnce(undefined) // revoke sessions
        .mockResolvedValueOnce(undefined); // COMMIT
      const client = { query, release: vi.fn() };
      const repository = new UsersRepository({ connect: vi.fn().mockResolvedValue(client) } as never);

      const result = await repository.deactivate(active.user_id, context);

      expect(result?.status).toBe('INACTIVE');
      expect(query).toHaveBeenNthCalledWith(8, expect.stringContaining('security.sessions'), [active.user_id]);
    });

    it('rejects deactivating an already-INACTIVE user', async () => {
      const inactive = { ...rawRow, status: 'INACTIVE' };
      const query = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [inactive] })
        .mockResolvedValueOnce(undefined); // ROLLBACK
      const client = { query, release: vi.fn() };
      const repository = new UsersRepository({ connect: vi.fn().mockResolvedValue(client) } as never);

      await expect(repository.deactivate(inactive.user_id, context)).rejects.toMatchObject({ code: 'USER_ALREADY_INACTIVE' });
    });

    it('rejects deactivating the last ACTIVE ADMIN', async () => {
      const lastAdmin = { ...rawRow, role: 'ADMIN', status: 'ACTIVE' };
      const query = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [lastAdmin] })
        .mockResolvedValueOnce({ rows: [{ user_id: lastAdmin.user_id }] })
        .mockResolvedValueOnce(undefined); // ROLLBACK
      const client = { query, release: vi.fn() };
      const repository = new UsersRepository({ connect: vi.fn().mockResolvedValue(client) } as never);

      await expect(repository.deactivate(lastAdmin.user_id, context)).rejects.toMatchObject({ code: 'LAST_ACTIVE_ADMIN' });
    });

    it('allows deactivating an admin when another ACTIVE ADMIN remains', async () => {
      const target = { ...rawRow, role: 'ADMIN', status: 'ACTIVE' };
      const query = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [target] })
        .mockResolvedValueOnce({ rows: [{ user_id: target.user_id }, { user_id: '2' }] })
        .mockResolvedValueOnce({ rows: [{ ...target, status: 'INACTIVE' }] })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      const client = { query, release: vi.fn() };
      const repository = new UsersRepository({ connect: vi.fn().mockResolvedValue(client) } as never);

      await expect(repository.deactivate(target.user_id, context)).resolves.toMatchObject({ status: 'INACTIVE' });
    });

    it('returns null when the target does not exist', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce(undefined);
      const client = { query, release: vi.fn() };
      const repository = new UsersRepository({ connect: vi.fn().mockResolvedValue(client) } as never);

      await expect(repository.deactivate('999', context)).resolves.toBeNull();
    });
  });

  describe('reactivate', () => {
    it('sets status ACTIVE without touching password or sessions', async () => {
      const inactive = { ...rawRow, status: 'INACTIVE' };
      const query = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [inactive] })
        .mockResolvedValueOnce({ rows: [{ ...inactive, status: 'ACTIVE' }] })
        .mockResolvedValueOnce(undefined); // COMMIT
      const client = { query, release: vi.fn() };
      const repository = new UsersRepository({ connect: vi.fn().mockResolvedValue(client) } as never);

      const result = await repository.reactivate(inactive.user_id, context);

      expect(result?.status).toBe('ACTIVE');
      expect(query).toHaveBeenCalledTimes(8);
      expect(query.mock.calls.some((call) => String(call[0]).includes('security.sessions'))).toBe(false);
    });

    it('rejects reactivating an already-ACTIVE user', async () => {
      const activeRow = { ...rawRow, status: 'ACTIVE' };
      const query = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [activeRow] })
        .mockResolvedValueOnce(undefined);
      const client = { query, release: vi.fn() };
      const repository = new UsersRepository({ connect: vi.fn().mockResolvedValue(client) } as never);

      await expect(repository.reactivate(activeRow.user_id, context)).rejects.toMatchObject({ code: 'USER_ALREADY_ACTIVE' });
    });
  });

  describe('adminResetPassword', () => {
    it('sets a new password hash, forces must_change_password=true, and revokes all sessions', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [rawRow] })
        .mockResolvedValueOnce({ rows: [{ ...rawRow, password_hash: 'new-hash', must_change_password: true }] })
        .mockResolvedValueOnce(undefined) // revoke sessions
        .mockResolvedValueOnce(undefined); // COMMIT
      const client = { query, release: vi.fn() };
      const repository = new UsersRepository({ connect: vi.fn().mockResolvedValue(client) } as never);

      const result = await repository.adminResetPassword(rawRow.user_id, 'new-hash', context);

      expect(result?.passwordHash).toBe('new-hash');
      expect(result?.mustChangePassword).toBe(true);
      expect(query).toHaveBeenNthCalledWith(8, expect.stringContaining('security.sessions'), [rawRow.user_id]);
    });

    it('returns null when the target does not exist', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce(undefined);
      const client = { query, release: vi.fn() };
      const repository = new UsersRepository({ connect: vi.fn().mockResolvedValue(client) } as never);

      await expect(repository.adminResetPassword('999', 'new-hash', context)).resolves.toBeNull();
    });
  });
});
