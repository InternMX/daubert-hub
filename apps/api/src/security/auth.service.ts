import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuditContext } from './audit-context';
import type { AuditIdentity } from '../common/authenticated-request';
import { LoginRateLimiterService } from './login-rate-limiter.service';
import { normalizeEmail } from './normalize-email';
import { PasswordPolicyError } from './password-policy';
import { PasswordService } from './password.service';
import { SessionsService } from './sessions.service';
import { toSafeUser, type SafeUser } from './users.types';
import { UsersService } from './users.service';

const INVALID_CREDENTIALS_MESSAGE = 'Correo o contraseña incorrectos.';
const WRONG_CURRENT_PASSWORD_MESSAGE = 'La contraseña actual no es correcta.';
const SAME_PASSWORD_MESSAGE = 'La nueva contraseña debe ser diferente a la actual.';

// A fixed, precomputed, valid Argon2id hash of an arbitrary constant string
// that is not, and will never be, a real user's password. Verifying against
// this when the email doesn't exist keeps the "wrong password" and "unknown
// email" paths doing comparable Argon2 work, instead of the unknown-email
// path returning near-instantly — a coarse, sensible mitigation, not a
// constant-time guarantee.
const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=19456,t=2,p=1$+CxAgV8cb9/v5ROEJWZmYg$Ki+t1+36zySMhvZkJRYOpjINGrTzKJjLa8+peae9nXI';

export interface LoginResult {
  user: SafeUser;
  token: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionsService,
    private readonly loginRateLimiter: LoginRateLimiterService
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const normalizedEmail = normalizeEmail(email);
    // Checked before any credential lookup: a caller already blocked never
    // triggers a database round trip or an Argon2 verification.
    this.loginRateLimiter.assertNotBlocked(normalizedEmail);

    const row = await this.users.findForAuthentication(email);
    const passwordMatches = await this.passwords.verifyPassword(row?.passwordHash ?? DUMMY_PASSWORD_HASH, password);

    // Unknown email, wrong password, and an inactive user all fail exactly
    // the same way externally — never reveal which condition applied. That
    // includes rate-limit bookkeeping: all three record a failure the same way.
    if (!row || !passwordMatches || row.status !== 'ACTIVE') {
      this.loginRateLimiter.recordFailure(normalizedEmail);
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    this.loginRateLimiter.recordSuccess(normalizedEmail);
    const session = await this.sessions.createSession(row.id);

    // A fresh, unrelated request id — never the raw session token, which
    // must never reach PostgreSQL in any form (it would otherwise risk
    // being persisted as audit.cambios.request_id if this update were ever
    // audited).
    const loginContext: AuditContext = { requestId: randomUUID(), origin: 'DAUBERT_HUB', actorUserId: row.id, actorUserEmail: row.email };
    const updated = await this.users.recordSuccessfulLogin(row.id, loginContext);

    return { user: updated ?? toSafeUser(row), token: session.token };
  }

  async logout(token: string): Promise<void> {
    await this.sessions.revokeByToken(token);
  }

  async getUserForToken(token: string): Promise<SafeUser | null> {
    const active = await this.sessions.resolveActiveSession(token);
    return active ? active.user : null;
  }

  // Self-service: the caller must already be authenticated (request.user);
  // this re-proves knowledge of the CURRENT password before accepting a new
  // one, independent of session validity. The session itself is untouched —
  // mustChangePassword flips to false and the existing session keeps working.
  async changePassword(userId: string, currentPassword: string, newPassword: string, identity: AuditIdentity): Promise<SafeUser> {
    const row = await this.users.findCredentialsById(userId);
    if (!row) throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);

    const currentMatches = await this.passwords.verifyPassword(row.passwordHash, currentPassword);
    if (!currentMatches) throw new UnauthorizedException(WRONG_CURRENT_PASSWORD_MESSAGE);

    if (newPassword === currentPassword) throw new BadRequestException(SAME_PASSWORD_MESSAGE);

    const context: AuditContext = { requestId: randomUUID(), origin: 'DAUBERT_HUB', actorUserId: identity.userId, actorUserEmail: identity.userEmail };
    try {
      const updated = await this.users.updatePassword(userId, newPassword, false, context);
      if (!updated) throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
      return updated;
    } catch (error) {
      if (error instanceof PasswordPolicyError) throw new BadRequestException(error.message);
      throw error;
    }
  }
}
