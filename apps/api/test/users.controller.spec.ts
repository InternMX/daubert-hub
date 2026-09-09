import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PasswordPolicyError } from '../src/security/password-policy';
import { ROLES_KEY } from '../src/security/route-access.decorators';
import { UsersController } from '../src/security/users.controller';
import { UserEmailConflictError, UserValidationError } from '../src/security/users.service';

const user = { id: '121', displayName: 'Admin', email: 'admin@example.test', role: 'ADMIN', status: 'ACTIVE', mustChangePassword: false, createdAt: '2026-01-01', updatedAt: '2026-01-01', lastLoginAt: null } as const;
const request = { requestId: 'request-users', user } as never;
const context = { requestId: 'request-users', origin: 'DAUBERT_HUB', actorUserId: '121', actorUserEmail: 'admin@example.test' };

describe('UsersController', () => {
  it('lists users and retrieves detail with an unchanged string ID', async () => {
    const service = { list: vi.fn().mockResolvedValue([user]), getUser: vi.fn().mockResolvedValue(user) };
    const controller = new UsersController(service as never);

    await expect(controller.list()).resolves.toEqual({ data: [user] });
    await expect(controller.detail('9007199254740993')).resolves.toEqual({ data: user });
    expect(service.getUser).toHaveBeenCalledWith('9007199254740993');
  });

  it.each(['0', '-1', '1.5', 'abc', ' 1', '1e3'])('rejects invalid user ID %s with 400', async (id) => {
    const getUser = vi.fn();
    const controller = new UsersController({ getUser } as never);

    await expect(controller.detail(id)).rejects.toMatchObject({ status: 400 });
    expect(getUser).not.toHaveBeenCalled();
  });

  it('rejects PostgreSQL BIGINT overflow with 400', async () => {
    const getUser = vi.fn();
    const controller = new UsersController({ getUser } as never);

    await expect(controller.detail('9223372036854775808')).rejects.toMatchObject({ status: 400 });
    expect(getUser).not.toHaveBeenCalled();
  });

  it('preserves the service not-found response', async () => {
    const error = new NotFoundException('Usuario no encontrado.');
    const controller = new UsersController({ getUser: vi.fn().mockRejectedValue(error) } as never);
    await expect(controller.detail('122')).rejects.toBe(error);
  });

  it('creates a user with the expected field mapping and audit context', async () => {
    const createUser = vi.fn().mockResolvedValue(user);
    const controller = new UsersController({ createUser } as never);
    const input = { displayName: 'General', email: 'general@example.test', role: 'GENERAL', temporaryPassword: 'temporary-passphrase' } as const;

    await expect(controller.create(input, request)).resolves.toEqual({ data: user });
    expect(createUser).toHaveBeenCalledWith(
      { displayName: 'General', email: 'general@example.test', role: 'GENERAL', password: 'temporary-passphrase' },
      context
    );
  });

  it.each([
    [new UserEmailConflictError(), 409, 'USER_EMAIL_CONFLICT'],
    [new UserValidationError('El nombre es requerido.'), 400, 'USER_VALIDATION_ERROR'],
    [new PasswordPolicyError('La contraseña debe tener al menos 12 caracteres.'), 400, undefined]
  ] as const)('maps create validation failures to the controller HTTP contract', async (error, status, code) => {
    const controller = new UsersController({ createUser: vi.fn().mockRejectedValue(error) } as never);

    try {
      await controller.create({ displayName: 'User', email: 'user@example.test', role: 'GENERAL', temporaryPassword: 'password' }, request);
      expect.unreachable();
    } catch (caught) {
      expect(caught).toMatchObject({ status });
      if (code) expect(caught).toMatchObject({ response: { code } });
    }
  });

  it('delegates update, deactivate, reactivate, and reset-password with string IDs and audit context', async () => {
    const service = {
      updateUser: vi.fn().mockResolvedValue(user),
      deactivateUser: vi.fn().mockResolvedValue(user),
      reactivateUser: vi.fn().mockResolvedValue(user),
      resetPassword: vi.fn().mockResolvedValue(user)
    };
    const controller = new UsersController(service as never);
    const id = '9007199254740993';

    await expect(controller.update(id, { displayName: 'Updated' }, request)).resolves.toEqual({ data: user });
    await expect(controller.deactivate(id, request)).resolves.toEqual({ data: user });
    await expect(controller.reactivate(id, request)).resolves.toEqual({ data: user });
    await expect(controller.resetPassword(id, { newPassword: 'new-secure-passphrase' }, request)).resolves.toEqual({ data: user });

    expect(service.updateUser).toHaveBeenCalledWith('121', id, { displayName: 'Updated' }, context);
    expect(service.deactivateUser).toHaveBeenCalledWith('121', id, context);
    expect(service.reactivateUser).toHaveBeenCalledWith(id, context);
    expect(service.resetPassword).toHaveBeenCalledWith('121', id, 'new-secure-passphrase', context);
    expect(typeof service.updateUser.mock.calls[0]?.[1]).toBe('string');
  });

  it.each(['update', 'deactivate', 'reactivate', 'resetPassword'] as const)('validates the ID before %s', async (operation) => {
    const handlerName = operation === 'update' ? 'updateUser' : operation === 'deactivate' ? 'deactivateUser' : operation === 'reactivate' ? 'reactivateUser' : 'resetPassword';
    const handler = vi.fn();
    const controller = new UsersController({ [handlerName]: handler } as never);

    if (operation === 'update') await expect(controller.update('9223372036854775808', {}, request)).rejects.toMatchObject({ status: 400 });
    if (operation === 'deactivate') await expect(controller.deactivate('9223372036854775808', request)).rejects.toMatchObject({ status: 400 });
    if (operation === 'reactivate') await expect(controller.reactivate('9223372036854775808', request)).rejects.toMatchObject({ status: 400 });
    if (operation === 'resetPassword') await expect(controller.resetPassword('9223372036854775808', { newPassword: 'new-secure-passphrase' }, request)).rejects.toMatchObject({ status: 400 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('declares ADMIN authorization at controller level', () => {
    expect(Reflect.getMetadata(ROLES_KEY, UsersController)).toEqual(['ADMIN']);
  });
});
