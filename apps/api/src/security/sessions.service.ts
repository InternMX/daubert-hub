import { Injectable } from '@nestjs/common';
import { generateSessionToken, hashSessionToken } from './session-token';
import { SessionsRepository } from './sessions.repository';
import type { SafeUser } from './users.types';

// Absolute V1 session lifetime. No rolling/idle extension, no refresh
// tokens: a session is valid for exactly this long from issuance.
export const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

@Injectable()
export class SessionsService {
  constructor(private readonly repository: SessionsRepository) {}

  async createSession(userId: string): Promise<IssuedSession> {
    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
    await this.repository.create(userId, hashSessionToken(token), expiresAt);
    return { token, expiresAt };
  }

  // Server-side re-validates revocation, expiry, and user status on every
  // call — a stale browser cookie is never trusted on its own.
  async resolveActiveSession(token: string): Promise<{ sessionId: string; user: SafeUser } | null> {
    return this.repository.findActiveByTokenHash(hashSessionToken(token));
  }

  // Revoke by hash without requiring the session to still be valid. Logout
  // must invalidate an expired session or one owned by an INACTIVE user too,
  // otherwise that token could become usable again after state restoration.
  // The guarded UPDATE remains idempotent for unknown/already-revoked tokens.
  async revokeByToken(token: string): Promise<void> {
    await this.repository.revokeByTokenHash(hashSessionToken(token));
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.repository.revokeAllForUser(userId);
  }
}
