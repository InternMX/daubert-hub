import { apiBaseUrl } from './api';
import type { UserRole, UserStatus } from './auth';

export type { UserRole, UserStatus };

// Only the safe fields the backend exposes (GET/POST/PATCH /api/users*).
// Never password_hash, session token, or token_hash.
export interface ManagedUser {
  id: string;
  displayName: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface CreateUserInput {
  displayName: string;
  email: string;
  role: UserRole;
  temporaryPassword: string;
}

export interface UpdateUserInput {
  displayName?: string;
  email?: string;
  role?: UserRole;
}

export class UsersApiError extends Error {
  constructor(public readonly status: number, public readonly code: string | undefined, message?: string) {
    super(message ?? 'Users API request failed');
  }
}

// /api/users* responses are flat — { data: ManagedUser } / { data: ManagedUser[] } —
// unlike /api/auth/*'s { data: { user: SafeUser } }. Confirmed against the actual
// Phase 6 UsersController rather than assumed.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, init);
  } catch {
    throw new UsersApiError(0, undefined);
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
    const message = typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string' ? body.message : undefined;
    throw new UsersApiError(response.status, code, message);
  }
  if (typeof body !== 'object' || body === null || !('data' in body)) throw new UsersApiError(response.status, undefined);
  return (body as { data: T }).data;
}

const jsonHeaders = { 'content-type': 'application/json' };

export function listUsers(): Promise<ManagedUser[]> {
  return request<ManagedUser[]>('/users');
}

export function getUser(id: string): Promise<ManagedUser> {
  return request<ManagedUser>(`/users/${encodeURIComponent(id)}`);
}

export function createUser(input: CreateUserInput): Promise<ManagedUser> {
  return request<ManagedUser>('/users', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) });
}

export function updateUser(id: string, input: UpdateUserInput): Promise<ManagedUser> {
  return request<ManagedUser>(`/users/${encodeURIComponent(id)}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify(input) });
}

export function deactivateUser(id: string): Promise<ManagedUser> {
  return request<ManagedUser>(`/users/${encodeURIComponent(id)}/deactivate`, { method: 'POST' });
}

export function reactivateUser(id: string): Promise<ManagedUser> {
  return request<ManagedUser>(`/users/${encodeURIComponent(id)}/reactivate`, { method: 'POST' });
}

export function resetPassword(id: string, newPassword: string): Promise<ManagedUser> {
  return request<ManagedUser>(`/users/${encodeURIComponent(id)}/reset-password`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ newPassword }) });
}

// The backend already returns concise, safe Spanish messages for every known
// business/validation error (USER_EMAIL_CONFLICT, LAST_ACTIVE_ADMIN,
// SELF_DEACTIVATION_NOT_ALLOWED, SELF_ROLE_CHANGE_NOT_ALLOWED,
// SELF_PASSWORD_RESET_NOT_ALLOWED, USER_ALREADY_INACTIVE/ACTIVE, role/password
// validation, "Usuario no encontrado.") — this only falls back to a generic
// message for network failures (status 0) or a body the API never sent
// (never a raw PostgreSQL/database error, which the backend never exposes).
export function describeUsersApiError(error: unknown, fallback: string): string {
  return error instanceof UsersApiError && error.status > 0 ? error.message : fallback;
}
