import { apiBaseUrl } from './api';

export type UserRole = 'ADMIN' | 'GENERAL';
export type UserStatus = 'ACTIVE' | 'INACTIVE';

// Only the safe fields the backend exposes for display purposes. Never carries
// a password hash or any session/token material.
export interface AuthUser {
  id: string;
  displayName: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  mustChangePassword: boolean;
}

export class AuthApiError extends Error {
  constructor(public readonly status: number, public readonly code: string | undefined, message?: string) {
    super(message ?? 'Auth API request failed');
  }
}

interface RawUser {
  id: string;
  displayName: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  mustChangePassword: boolean;
}

function toAuthUser(raw: RawUser): AuthUser {
  return {
    id: raw.id,
    displayName: raw.displayName,
    email: raw.email,
    role: raw.role,
    status: raw.status,
    mustChangePassword: raw.mustChangePassword
  };
}

async function requestUser(path: string, init?: RequestInit): Promise<AuthUser> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, init);
  } catch {
    throw new AuthApiError(0, undefined);
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
    const message = typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string' ? body.message : undefined;
    throw new AuthApiError(response.status, code, message);
  }

  if (typeof body !== 'object' || body === null || !('data' in body)) throw new AuthApiError(response.status, undefined);
  const data = (body as { data: { user: RawUser } }).data;
  return toAuthUser(data.user);
}

export function login(email: string, password: string): Promise<AuthUser> {
  return requestUser('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
}

export function getCurrentUser(): Promise<AuthUser> {
  return requestUser('/auth/me');
}

// Logout is idempotent on the backend and must never leave the frontend
// unable to clear its own authenticated state, so a network failure here is
// swallowed rather than surfaced — the caller always proceeds to sign out.
export async function logout(): Promise<void> {
  try {
    await fetch(`${apiBaseUrl}/auth/logout`, { method: 'POST' });
  } catch {
    /* Frontend state is cleared regardless; see comment above. */
  }
}

export function changePassword(currentPassword: string, newPassword: string): Promise<AuthUser> {
  return requestUser('/auth/change-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }) });
}
