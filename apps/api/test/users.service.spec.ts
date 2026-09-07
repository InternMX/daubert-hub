import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { UserEmailConflictError, UsersService, UserValidationError } from '../src/security/users.service';
import { PasswordPolicyError } from '../src/security/password-policy';
import type { UserRow } from '../src/security/users.types';

const context = { requestId: 'req-1', origin: 'DAUBERT_HUB_BOOTSTRAP', actorUserId: null, actorUserEmail: null };

function row(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: '9007199254740993123',
    displayName: 'Ana Admin',
    email: 'ana@example.test',
    passwordHash: '$argon2id$stored-hash',
    role: 'ADMIN',
    status: 'ACTIVE',
    mustChangePassword: true,
    createdAt: '2026-09-05T10:00:00.000Z',
    updatedAt: '2026-09-05T10:00:00.000Z',
    lastLoginAt: null,
    ...overrides
  };
}

function setup() {
  const repository = {
    findByEmail: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    updatePassword: vi.fn(),
    list: vi.fn(),
    updateProfile: vi.fn(),
    deactivate: vi.fn(),
    reactivate: vi.fn(),
    adminResetPassword: vi.fn()
  };
  const passwords = { hashPassword: vi.fn().mockResolvedValue('$argon2id$stored-hash'), verifyPassword: vi.fn() };
  const service = new UsersService(repository as never, passwords as never);
  return { service, repository, passwords };
}

const admin = () => row({ id: '1', role: 'ADMIN', status: 'ACTIVE' });
const targetGeneral = () => row({ id: '2', role: 'GENERAL', status: 'ACTIVE' });

describe('UsersService.createUser', () => {
  it('creates an ADMIN user as ACTIVE with must_change_password true', async () => {
    const { service, repository, passwords } = setup();
    repository.create.mockResolvedValue(row({ role: 'ADMIN' }));

    const result = await service.createUser({ displayName: 'Ana Admin', email: 'ana@example.test', password: 'a-valid-password', role: 'ADMIN' }, context);

    expect(passwords.hashPassword).toHaveBeenCalledWith('a-valid-password');
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'ADMIN', status: 'ACTIVE', mustChangePassword: true, passwordHash: '$argon2id$stored-hash' }),
      context
    );
    expect(result.role).toBe('ADMIN');
  });

  it('creates a GENERAL user the same way', async () => {
    const { service, repository } = setup();
    repository.create.mockResolvedValue(row({ role: 'GENERAL' }));
    const result = await service.createUser({ displayName: 'Gen User', email: 'gen@example.test', password: 'a-valid-password', role: 'GENERAL' }, context);
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ role: 'GENERAL', status: 'ACTIVE', mustChangePassword: true }), context);
    expect(result.role).toBe('GENERAL');
  });

  it('maps a duplicate case-insensitive email conflict to a safe, specific error without leaking DB details', async () => {
    const { service, repository } = setup();
    repository.create.mockRejectedValue({ code: '23505', constraint: 'uq_users_email' });
    await expect(service.createUser({ displayName: 'Dup', email: 'DUP@Example.test', password: 'a-valid-password', role: 'GENERAL' }, context))
      .rejects.toBeInstanceOf(UserEmailConflictError);
  });

  it('rethrows unrelated database errors unchanged', async () => {
    const { service, repository } = setup();
    const other = { code: '23503' };
    repository.create.mockRejectedValue(other);
    await expect(service.createUser({ displayName: 'X', email: 'x@example.test', password: 'a-valid-password', role: 'GENERAL' }, context)).rejects.toBe(other);
  });

  it('rejects a blank display name without calling the repository', async () => {
    const { service, repository } = setup();
    await expect(service.createUser({ displayName: '   ', email: 'x@example.test', password: 'a-valid-password', role: 'GENERAL' }, context)).rejects.toBeInstanceOf(UserValidationError);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects a blank email without calling the repository', async () => {
    const { service, repository } = setup();
    await expect(service.createUser({ displayName: 'X', email: '   ', password: 'a-valid-password', role: 'GENERAL' }, context)).rejects.toBeInstanceOf(UserValidationError);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid role without calling the repository', async () => {
    const { service, repository } = setup();
    await expect(service.createUser({ displayName: 'X', email: 'x@example.test', password: 'a-valid-password', role: 'SUPERUSER' as never }, context)).rejects.toBeInstanceOf(UserValidationError);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects a policy-violating password without calling the repository', async () => {
    const { service, repository } = setup();
    await expect(service.createUser({ displayName: 'X', email: 'x@example.test', password: 'short', role: 'GENERAL' }, context)).rejects.toBeInstanceOf(PasswordPolicyError);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('never exposes password_hash on the returned safe user representation', async () => {
    const { service, repository } = setup();
    repository.create.mockResolvedValue(row());
    const result = await service.createUser({ displayName: 'Ana Admin', email: 'ana@example.test', password: 'a-valid-password', role: 'ADMIN' }, context);
    expect(result).not.toHaveProperty('passwordHash');
    expect(Object.keys(result).sort()).toEqual(['createdAt', 'displayName', 'email', 'id', 'lastLoginAt', 'mustChangePassword', 'role', 'status', 'updatedAt'].sort());
  });

  it('keeps a BIGINT user id exact as a string through the safe representation', async () => {
    const { service, repository } = setup();
    repository.create.mockResolvedValue(row({ id: '9223372036854775807' }));
    const result = await service.createUser({ displayName: 'Ana Admin', email: 'ana@example.test', password: 'a-valid-password', role: 'ADMIN' }, context);
    expect(result.id).toBe('9223372036854775807');
    expect(typeof result.id).toBe('string');
  });
});

describe('UsersService.findForAuthentication', () => {
  it('returns the password-bearing row for a future Auth phase to verify against', async () => {
    const { service, repository } = setup();
    repository.findByEmail.mockResolvedValue(row());
    const result = await service.findForAuthentication('  Ana@Example.test  ');
    expect(repository.findByEmail).toHaveBeenCalledWith('Ana@Example.test');
    expect(result?.passwordHash).toBe('$argon2id$stored-hash');
  });

  it('returns null for a blank email without querying', async () => {
    const { service, repository } = setup();
    await expect(service.findForAuthentication('   ')).resolves.toBeNull();
    expect(repository.findByEmail).not.toHaveBeenCalled();
  });
});

describe('UsersService.updatePassword', () => {
  it('hashes the new password and sets must_change_password exactly as instructed by the caller', async () => {
    const { service, repository, passwords } = setup();
    repository.updatePassword.mockResolvedValue(row({ mustChangePassword: false }));
    const result = await service.updatePassword('9007199254740993123', 'a-new-valid-password', false, context);
    expect(passwords.hashPassword).toHaveBeenCalledWith('a-new-valid-password');
    expect(repository.updatePassword).toHaveBeenCalledWith('9007199254740993123', '$argon2id$stored-hash', false, context);
    expect(result?.mustChangePassword).toBe(false);
  });

  it('an administrator-driven reset sets must_change_password true', async () => {
    const { service, repository } = setup();
    repository.updatePassword.mockResolvedValue(row({ mustChangePassword: true }));
    await service.updatePassword('9007199254740993123', 'a-new-valid-password', true, context);
    expect(repository.updatePassword).toHaveBeenCalledWith('9007199254740993123', expect.any(String), true, context);
  });

  it('rejects a policy-violating new password before hashing or persisting', async () => {
    const { service, repository, passwords } = setup();
    await expect(service.updatePassword('1', 'short', false, context)).rejects.toBeInstanceOf(PasswordPolicyError);
    expect(passwords.hashPassword).not.toHaveBeenCalled();
    expect(repository.updatePassword).not.toHaveBeenCalled();
  });

  it('returns null when the target user does not exist', async () => {
    const { service, repository } = setup();
    repository.updatePassword.mockResolvedValue(null);
    await expect(service.updatePassword('999', 'a-new-valid-password', false, context)).resolves.toBeNull();
  });
});

describe('UsersService.list / getUser', () => {
  it('lists safe users only', async () => {
    const { service, repository } = setup();
    repository.list.mockResolvedValue([admin(), targetGeneral()]);
    const users = await service.list();
    expect(users).toHaveLength(2);
    expect(users.every((user) => !('passwordHash' in user))).toBe(true);
  });

  it('returns a safe user detail', async () => {
    const { service, repository } = setup();
    repository.findById.mockResolvedValue(targetGeneral());
    const user = await service.getUser('2');
    expect(user).not.toHaveProperty('passwordHash');
    expect(user.id).toBe('2');
  });

  it('throws NotFoundException for a missing user', async () => {
    const { service, repository } = setup();
    repository.findById.mockResolvedValue(null);
    await expect(service.getUser('999')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UsersService.updateUser', () => {
  it('edits displayName', async () => {
    const { service, repository } = setup();
    repository.updateProfile.mockResolvedValue(row({ displayName: 'New Name' }));
    const user = await service.updateUser('1', '2', { displayName: 'New Name' }, context);
    expect(repository.updateProfile).toHaveBeenCalledWith('2', { displayName: 'New Name', email: undefined, role: undefined }, context);
    expect(user.displayName).toBe('New Name');
  });

  it('edits email', async () => {
    const { service, repository } = setup();
    repository.updateProfile.mockResolvedValue(row({ email: 'new@example.test' }));
    const user = await service.updateUser('1', '2', { email: 'new@example.test' }, context);
    expect(repository.updateProfile).toHaveBeenCalledWith('2', { displayName: undefined, email: 'new@example.test', role: undefined }, context);
    expect(user.email).toBe('new@example.test');
  });

  it('edits role', async () => {
    const { service, repository } = setup();
    repository.updateProfile.mockResolvedValue(row({ role: 'ADMIN' }));
    const user = await service.updateUser('1', '2', { role: 'ADMIN' }, context);
    expect(repository.updateProfile).toHaveBeenCalledWith('2', { displayName: undefined, email: undefined, role: 'ADMIN' }, context);
    expect(user.role).toBe('ADMIN');
  });

  it('rejects an empty PATCH payload without calling the repository', async () => {
    const { service, repository } = setup();
    await expect(service.updateUser('1', '2', {}, context)).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.updateProfile).not.toHaveBeenCalled();
  });

  it('rejects an ADMIN changing their own role, without calling the repository', async () => {
    const { service, repository } = setup();
    await expect(service.updateUser('1', '1', { role: 'GENERAL' }, context)).rejects.toMatchObject({ response: { code: 'SELF_ROLE_CHANGE_NOT_ALLOWED' } });
    expect(repository.updateProfile).not.toHaveBeenCalled();
  });

  it('allows an ADMIN editing their own displayName/email', async () => {
    const { service, repository } = setup();
    repository.updateProfile.mockResolvedValue(row({ id: '1', displayName: 'Self Edit' }));
    await expect(service.updateUser('1', '1', { displayName: 'Self Edit' }, context)).resolves.toMatchObject({ displayName: 'Self Edit' });
  });

  it('maps a repository LAST_ACTIVE_ADMIN rejection to a 409 Conflict', async () => {
    const { service, repository } = setup();
    repository.updateProfile.mockRejectedValue(Object.assign(new Error('LAST_ACTIVE_ADMIN'), { code: 'LAST_ACTIVE_ADMIN' }));
    await expect(service.updateUser('1', '2', { role: 'GENERAL' }, context)).rejects.toBeInstanceOf(ConflictException);
  });

  it('maps a repository duplicate-email rejection to a 409 Conflict', async () => {
    const { service, repository } = setup();
    repository.updateProfile.mockRejectedValue({ code: '23505', constraint: 'uq_users_email' });
    await expect(service.updateUser('1', '2', { email: 'dup@example.test' }, context)).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws NotFoundException when the target does not exist', async () => {
    const { service, repository } = setup();
    repository.updateProfile.mockResolvedValue(null);
    await expect(service.updateUser('1', '999', { displayName: 'X' }, context)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UsersService.deactivateUser', () => {
  it('rejects an ADMIN deactivating their own account, without calling the repository', async () => {
    const { service, repository } = setup();
    await expect(service.deactivateUser('1', '1', context)).rejects.toMatchObject({ response: { code: 'SELF_DEACTIVATION_NOT_ALLOWED' } });
    expect(repository.deactivate).not.toHaveBeenCalled();
  });

  it('deactivates another user (implies session revocation, handled transactionally by the repository)', async () => {
    const { service, repository } = setup();
    repository.deactivate.mockResolvedValue(row({ id: '2', status: 'INACTIVE' }));
    const user = await service.deactivateUser('1', '2', context);
    expect(repository.deactivate).toHaveBeenCalledWith('2', context);
    expect(user.status).toBe('INACTIVE');
  });

  it('maps a repository LAST_ACTIVE_ADMIN rejection to a 409 Conflict', async () => {
    const { service, repository } = setup();
    repository.deactivate.mockRejectedValue(Object.assign(new Error('LAST_ACTIVE_ADMIN'), { code: 'LAST_ACTIVE_ADMIN' }));
    await expect(service.deactivateUser('1', '2', context)).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws NotFoundException when the target does not exist', async () => {
    const { service, repository } = setup();
    repository.deactivate.mockResolvedValue(null);
    await expect(service.deactivateUser('1', '999', context)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UsersService.reactivateUser', () => {
  it('reactivates a user', async () => {
    const { service, repository } = setup();
    repository.reactivate.mockResolvedValue(row({ id: '2', status: 'ACTIVE' }));
    const user = await service.reactivateUser('2', context);
    expect(repository.reactivate).toHaveBeenCalledWith('2', context);
    expect(user.status).toBe('ACTIVE');
  });

  it('throws NotFoundException when the target does not exist', async () => {
    const { service, repository } = setup();
    repository.reactivate.mockResolvedValue(null);
    await expect(service.reactivateUser('999', context)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UsersService.resetPassword (administrator-driven)', () => {
  it('rejects an ADMIN resetting their own password through this endpoint, without hashing or calling the repository', async () => {
    const { service, repository, passwords } = setup();
    await expect(service.resetPassword('1', '1', 'a-new-valid-password', context)).rejects.toMatchObject({ response: { code: 'SELF_PASSWORD_RESET_NOT_ALLOWED' } });
    expect(passwords.hashPassword).not.toHaveBeenCalled();
    expect(repository.adminResetPassword).not.toHaveBeenCalled();
  });

  it('hashes the new password, and the repository sets mustChangePassword=true and revokes sessions', async () => {
    const { service, repository, passwords } = setup();
    repository.adminResetPassword.mockResolvedValue(row({ id: '2', mustChangePassword: true }));
    const user = await service.resetPassword('1', '2', 'a-new-valid-password', context);
    expect(passwords.hashPassword).toHaveBeenCalledWith('a-new-valid-password');
    expect(repository.adminResetPassword).toHaveBeenCalledWith('2', '$argon2id$stored-hash', context);
    expect(user.mustChangePassword).toBe(true);
  });

  it('rejects a policy-violating password before hashing or persisting', async () => {
    const { service, repository, passwords } = setup();
    await expect(service.resetPassword('1', '2', 'short', context)).rejects.toBeInstanceOf(BadRequestException);
    expect(passwords.hashPassword).not.toHaveBeenCalled();
    expect(repository.adminResetPassword).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the target does not exist', async () => {
    const { service, repository } = setup();
    repository.adminResetPassword.mockResolvedValue(null);
    await expect(service.resetPassword('1', '999', 'a-new-valid-password', context)).rejects.toBeInstanceOf(NotFoundException);
  });
});
