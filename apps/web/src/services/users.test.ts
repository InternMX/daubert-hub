import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createUser,
  deactivateUser,
  describeUsersApiError,
  getUser,
  listUsers,
  reactivateUser,
  resetPassword,
  updateUser,
  UsersApiError
} from './users';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const managedUser = {
  id: '9007199254740993123',
  displayName: 'Ana Admin',
  email: 'ana@daubertcromwell.com',
  role: 'ADMIN' as const,
  status: 'ACTIVE' as const,
  mustChangePassword: true,
  createdAt: '2026-09-05T10:00:00.000Z',
  updatedAt: '2026-09-05T10:00:00.000Z',
  lastLoginAt: null
};

afterEach(() => vi.unstubAllGlobals());

describe('users service', () => {
  it('lists users from the flat { data: ManagedUser[] } envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [managedUser] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listUsers()).resolves.toEqual([managedUser]);
    expect(fetchMock).toHaveBeenCalledWith('/api/users', undefined);
  });

  it('gets a single user from the flat { data: ManagedUser } envelope (not nested under "user")', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: managedUser })));
    await expect(getUser(managedUser.id)).resolves.toEqual(managedUser);
  });

  it('keeps a BIGINT id exact as a string', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { ...managedUser, id: '9223372036854775807' } })));
    const user = await getUser('9223372036854775807');
    expect(user.id).toBe('9223372036854775807');
    expect(typeof user.id).toBe('string');
  });

  it('creates a user', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: managedUser }, 201));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createUser({ displayName: 'Ana Admin', email: 'ana@daubertcromwell.com', role: 'ADMIN', temporaryPassword: 'a-valid-temp-password' });

    expect(result).toEqual(managedUser);
    expect(fetchMock).toHaveBeenCalledWith('/api/users', expect.objectContaining({ method: 'POST' }));
  });

  it('surfaces a duplicate-email conflict with its code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ statusCode: 409, code: 'USER_EMAIL_CONFLICT', message: 'Ya existe un usuario registrado con ese correo electrónico.' }, 409)));
    await expect(createUser({ displayName: 'X', email: 'dup@example.test', role: 'GENERAL', temporaryPassword: 'a-valid-temp-password' }))
      .rejects.toMatchObject({ status: 409, code: 'USER_EMAIL_CONFLICT' });
  });

  it('updates a user', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { ...managedUser, displayName: 'New Name' } })));
    const result = await updateUser(managedUser.id, { displayName: 'New Name' });
    expect(result.displayName).toBe('New Name');
  });

  it('deactivates a user', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { ...managedUser, status: 'INACTIVE' } })));
    const result = await deactivateUser(managedUser.id);
    expect(result.status).toBe('INACTIVE');
  });

  it('reactivates a user', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { ...managedUser, status: 'ACTIVE' } })));
    const result = await reactivateUser(managedUser.id);
    expect(result.status).toBe('ACTIVE');
  });

  it('resets a password', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { ...managedUser, mustChangePassword: true } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await resetPassword(managedUser.id, 'a-new-temp-password');
    expect(result.mustChangePassword).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ newPassword: 'a-new-temp-password' });
  });

  it('surfaces a network failure as status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(listUsers()).rejects.toMatchObject({ status: 0 });
  });
});

describe('describeUsersApiError', () => {
  it('uses the backend message for a real API error', () => {
    const error = new UsersApiError(409, 'LAST_ACTIVE_ADMIN', 'No es posible completar esta acción: debe existir al menos un administrador activo.');
    expect(describeUsersApiError(error, 'fallback')).toBe('No es posible completar esta acción: debe existir al menos un administrador activo.');
  });

  it('falls back for a network failure (status 0)', () => {
    const error = new UsersApiError(0, undefined);
    expect(describeUsersApiError(error, 'fallback')).toBe('fallback');
  });

  it('falls back for a non-UsersApiError', () => {
    expect(describeUsersApiError(new Error('boom'), 'fallback')).toBe('fallback');
  });
});
