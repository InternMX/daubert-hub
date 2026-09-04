import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import type { SafeUser } from './users.types';

// security.sessions carries NO audit trigger by design (Phase 1) — session
// issuance/expiry/revocation is authentication infrastructure, not
// business/admin CRUD, and this repository never calls set_config(...) for
// this table (there is no trigger reading those session variables here).
@Injectable()
export class SessionsRepository {
  constructor(private readonly database: DatabaseService) {}

  async create(userId: string, tokenHash: string, expiresAt: Date): Promise<{ sessionId: string }> {
    const rows = await this.database.query<{ session_id: string }>(
      `INSERT INTO security.sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3) RETURNING session_id::text AS session_id`,
      [userId, tokenHash, expiresAt.toISOString()]
    );
    return { sessionId: rows[0]!.session_id };
  }

  // A single query encodes every validity rule at once: not revoked, not
  // expired, and the owning user is ACTIVE. Any failing condition yields
  // zero rows — server-side, regardless of what the browser's cookie says.
  async findActiveByTokenHash(tokenHash: string): Promise<{ sessionId: string; user: SafeUser } | null> {
    const rows = await this.database.query<RawActiveSessionRow>(
      `SELECT s.session_id::text AS session_id, u.user_id::text AS user_id, u.display_name, u.email, u.role, u.status,
         u.must_change_password, u.created_at, u.updated_at, u.last_login_at
       FROM security.sessions s
       JOIN security.users u ON u.user_id = s.user_id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
         AND u.status = 'ACTIVE'`,
      [tokenHash]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      sessionId: row.session_id,
      user: {
        id: row.user_id,
        displayName: row.display_name,
        email: row.email,
        role: row.role as SafeUser['role'],
        status: row.status as SafeUser['status'],
        mustChangePassword: row.must_change_password,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastLoginAt: row.last_login_at
      }
    };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.database.query('UPDATE security.sessions SET revoked_at = now() WHERE session_id = $1 AND revoked_at IS NULL', [sessionId]);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.database.query('UPDATE security.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  }
}

interface RawActiveSessionRow extends QueryResultRow {
  session_id: string;
  user_id: string;
  display_name: string;
  email: string;
  role: string;
  status: string;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}
