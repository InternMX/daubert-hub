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

  // Idempotent by construction: an unknown/already-revoked/expired token
  // simply resolves to nothing and this becomes a no-op — never an error,
  // never a signal to the caller about which case applied.
  async revokeByToken(token: string): Promise<void> {
    const active = await this.resolveActiveSession(token);
    if (active) await this.repository.revoke(active.sessionId);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.repository.revokeAllForUser(userId);
  }
}
