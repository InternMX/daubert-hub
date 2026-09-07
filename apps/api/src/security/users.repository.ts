import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import type { AuditContext } from './audit-context';
import type { UserRole, UserRow, UserStatus } from './users.types';

interface RawUserRow extends QueryResultRow {
  user_id: string;
  display_name: string;
  email: string;
  password_hash: string;
  role: string;
  status: string;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export interface CreateUserInput {
  displayName: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  mustChangePassword: boolean;
}

// Only the fields PATCH /users/:userId is allowed to touch. Any field left
// undefined is not part of the update.
export interface UpdateUserProfileInput {
  displayName?: string;
  email?: string;
  role?: UserRole;
}

const userColumns = `user_id::text AS user_id, display_name, email, password_hash, role, status,
  must_change_password, created_at, updated_at, last_login_at`;

function mapRow(row: RawUserRow): UserRow {
  return {
    id: row.user_id,
    displayName: row.display_name,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role as UserRole,
    status: row.status as UserStatus,
    mustChangePassword: row.must_change_password,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at
  };
}

@Injectable()
export class UsersRepository {
  constructor(private readonly database: DatabaseService) {}

  async findByEmail(email: string): Promise<UserRow | null> {
    // Case-insensitive, matching uq_users_email's lower(btrim(email)) index.
    const rows = await this.database.query<RawUserRow>(
      `SELECT ${userColumns} FROM security.users WHERE lower(btrim(email)) = lower(btrim($1))`,
      [email]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async findById(userId: string): Promise<UserRow | null> {
    const rows = await this.database.query<RawUserRow>(
      `SELECT ${userColumns} FROM security.users WHERE user_id = $1`,
      [userId]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  // Ordered for a small, stable admin listing (V1 has no pagination — see
  // Phase 6 notes: user count is expected to remain small).
  async list(): Promise<UserRow[]> {
    const rows = await this.database.query<RawUserRow>(`SELECT ${userColumns} FROM security.users ORDER BY display_name ASC`);
    return rows.map(mapRow);
  }

  async create(input: CreateUserInput, context: AuditContext): Promise<UserRow> {
    return this.transaction(context, async (client) => {
      const result = await client.query<RawUserRow>(
        `INSERT INTO security.users (display_name, email, password_hash, role, status, must_change_password)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${userColumns}`,
        [input.displayName, input.email, input.passwordHash, input.role, input.status, input.mustChangePassword]
      );
      return mapRow(result.rows[0]!);
    });
  }

  // Persists only the new hash; the plaintext never reaches this layer (the
  // caller must have already hashed it). mustChangePassword is set exactly
  // as the caller intends — the repository does not infer it. Sessions are
  // deliberately left untouched here: this is the self-service change-password
  // path (Phase 4/5), where the existing session must keep working. The
  // administrator-driven reset path is adminResetPassword below.
  async updatePassword(userId: string, passwordHash: string, mustChangePassword: boolean, context: AuditContext): Promise<UserRow | null> {
    return this.transaction(context, async (client) => {
      const result = await client.query<RawUserRow>(
        `UPDATE security.users
         SET password_hash = $1, must_change_password = $2
         WHERE user_id = $3
         RETURNING ${userColumns}`,
        [passwordHash, mustChangePassword, userId]
      );
      return result.rows[0] ? mapRow(result.rows[0]) : null;
    });
  }

  // Updates only last_login_at (the sanitized security.users trigger
  // excludes it, along with updated_at, from its "did anything meaningfully
  // change" comparison, so a successful login alone produces no
  // audit.cambios row — see the Phase 3 migration notes).
  async touchLastLogin(userId: string, context: AuditContext): Promise<UserRow | null> {
    return this.transaction(context, async (client) => {
      const result = await client.query<RawUserRow>(
        `UPDATE security.users SET last_login_at = now() WHERE user_id = $1 RETURNING ${userColumns}`,
        [userId]
      );
      return result.rows[0] ? mapRow(result.rows[0]) : null;
    });
  }

  // ADMIN-facing profile edit: displayName/email/role only. Revokes the
  // target's sessions when role or email changes (authorization/authentication
  // identity), but not for a displayName-only change (presentation only) — the
  // approved Phase 6 session-revocation matrix. A role change away from ADMIN
  // is guarded against leaving zero ACTIVE admins (see assertNotLastActiveAdmin).
  async updateProfile(userId: string, input: UpdateUserProfileInput, context: AuditContext): Promise<UserRow | null> {
    return this.transaction(context, async (client) => {
      const current = await this.findByIdForUpdate(client, userId);
      if (!current) return null;

      const demotingActiveAdmin = input.role !== undefined && input.role !== 'ADMIN' && current.role === 'ADMIN' && current.status === 'ACTIVE';
      if (demotingActiveAdmin) await this.assertNotLastActiveAdmin(client);

      const sets: string[] = [];
      const values: unknown[] = [];
      if (input.displayName !== undefined) { values.push(input.displayName); sets.push(`display_name = $${values.length}`); }
      if (input.email !== undefined) { values.push(input.email); sets.push(`email = $${values.length}`); }
      if (input.role !== undefined) { values.push(input.role); sets.push(`role = $${values.length}`); }
      values.push(userId);

      const result = await client.query<RawUserRow>(
        `UPDATE security.users SET ${sets.join(', ')} WHERE user_id = $${values.length} RETURNING ${userColumns}`,
        values
      );
      const updated = result.rows[0] ? mapRow(result.rows[0]) : null;
      if (!updated) return null;

      const emailChanged = input.email !== undefined && input.email.toLowerCase() !== current.email.toLowerCase();
      const roleChanged = input.role !== undefined && input.role !== current.role;
      if (emailChanged || roleChanged) await this.revokeSessions(client, userId);

      return updated;
    });
  }

  // status -> INACTIVE plus revoking every session for the target, atomically:
  // the target must lose access immediately even if a browser still holds the
  // cookie. Guarded against deactivating the last ACTIVE ADMIN.
  async deactivate(userId: string, context: AuditContext): Promise<UserRow | null> {
    return this.transaction(context, async (client) => {
      const current = await this.findByIdForUpdate(client, userId);
      if (!current) return null;
      if (current.status === 'INACTIVE') this.fail('USER_ALREADY_INACTIVE');
      if (current.role === 'ADMIN') await this.assertNotLastActiveAdmin(client);

      const result = await client.query<RawUserRow>(
        `UPDATE security.users SET status = 'INACTIVE' WHERE user_id = $1 RETURNING ${userColumns}`,
        [userId]
      );
      await this.revokeSessions(client, userId);
      return mapRow(result.rows[0]!);
    });
  }

  // status -> ACTIVE only. Deliberately does not touch password_hash,
  // must_change_password, or sessions — reactivation never restores a
  // session and never silently changes credentials.
  async reactivate(userId: string, context: AuditContext): Promise<UserRow | null> {
    return this.transaction(context, async (client) => {
      const current = await this.findByIdForUpdate(client, userId);
      if (!current) return null;
      if (current.status === 'ACTIVE') this.fail('USER_ALREADY_ACTIVE');

      const result = await client.query<RawUserRow>(
        `UPDATE security.users SET status = 'ACTIVE' WHERE user_id = $1 RETURNING ${userColumns}`,
        [userId]
      );
      return mapRow(result.rows[0]!);
    });
  }

  // Administrator-driven password reset: unlike updatePassword above, this
  // always sets must_change_password = true and always revokes every session
  // for the target, atomically with the password change.
  async adminResetPassword(userId: string, passwordHash: string, context: AuditContext): Promise<UserRow | null> {
    return this.transaction(context, async (client) => {
      const current = await this.findByIdForUpdate(client, userId);
      if (!current) return null;

      const result = await client.query<RawUserRow>(
        `UPDATE security.users SET password_hash = $1, must_change_password = TRUE WHERE user_id = $2 RETURNING ${userColumns}`,
        [passwordHash, userId]
      );
      await this.revokeSessions(client, userId);
      return mapRow(result.rows[0]!);
    });
  }

  private async findByIdForUpdate(client: PoolClient, userId: string): Promise<UserRow | null> {
    const result = await client.query<RawUserRow>(`SELECT ${userColumns} FROM security.users WHERE user_id = $1 FOR UPDATE`, [userId]);
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  // Locks every currently ACTIVE ADMIN row (FOR UPDATE) and rejects when that
  // set has one member or fewer. Two concurrent transactions both attempting
  // to remove an ACTIVE ADMIN necessarily overlap on this row set, so Postgres
  // serializes them: the second transaction blocks until the first commits,
  // then re-evaluates the WHERE clause against the now-committed state before
  // deciding — the smallest correct concurrency strategy for a rare operation,
  // no advisory locks or SERIALIZABLE isolation required.
  private async assertNotLastActiveAdmin(client: PoolClient): Promise<void> {
    const result = await client.query<{ user_id: string }>(
      `SELECT user_id::text AS user_id FROM security.users WHERE role = 'ADMIN' AND status = 'ACTIVE' FOR UPDATE`
    );
    if (result.rows.length <= 1) this.fail('LAST_ACTIVE_ADMIN');
  }

  // security.sessions carries no audit trigger (Phase 1) — this plain UPDATE,
  // run on the SAME transactional client as the security.users mutation
  // above it, is what makes "mutate user + revoke sessions" atomic.
  private async revokeSessions(client: PoolClient, userId: string): Promise<void> {
    await client.query('UPDATE security.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  }

  private fail(code: string): never {
    throw Object.assign(new Error(code), { code });
  }

  private async transaction<T>(context: AuditContext, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await this.setAuditContext(client, context);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original database error.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async setAuditContext(client: PoolClient, context: AuditContext): Promise<void> {
    await client.query("SELECT set_config('app.origin', $1, true)", [context.origin]);
    await client.query("SELECT set_config('app.request_id', $1, true)", [context.requestId]);
    await client.query("SELECT set_config('app.user_id', COALESCE($1, ''), true)", [context.actorUserId]);
    await client.query("SELECT set_config('app.user_email', COALESCE($1, ''), true)", [context.actorUserEmail]);
  }
}
