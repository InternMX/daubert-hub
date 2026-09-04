import type { SafeUser } from '../security/users.types';
import type { RequestWithId } from './request-id.middleware';

// Single explicit contract for "a request that has passed AuthGuard".
// request.user is only ever set by AuthGuard, from a resolved active
// session — never trust a manually-cast `request as any` anywhere else.
export interface AuthenticatedRequest extends RequestWithId {
  user?: SafeUser;
}

export interface AuditIdentity {
  userId: string | null;
  userEmail: string | null;
}

// Shared by every controller that mutates data, so the same
// userId/userEmail extraction logic (and its BIGINT-safe string handling)
// exists in exactly one place rather than one private copy per controller.
export function identityFromRequest(request: AuthenticatedRequest): AuditIdentity {
  return { userId: request.user?.id ?? null, userEmail: request.user?.email ?? null };
}
