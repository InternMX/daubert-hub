import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuditContext } from './audit-context';
import { PasswordService } from './password.service';
import { SessionsService } from './sessions.service';
import { toSafeUser, type SafeUser } from './users.types';
import { UsersService } from './users.service';

const INVALID_CREDENTIALS_MESSAGE = 'Correo o contraseña incorrectos.';

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
    private readonly sessions: SessionsService
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const row = await this.users.findForAuthentication(email);
    const passwordMatches = await this.passwords.verifyPassword(row?.passwordHash ?? DUMMY_PASSWORD_HASH, password);

    // Unknown email, wrong password, and an inactive user all fail exactly
    // the same way externally — never reveal which condition applied.
    if (!row || !passwordMatches || row.status !== 'ACTIVE') {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

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
}
