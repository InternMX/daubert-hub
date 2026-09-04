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
});
