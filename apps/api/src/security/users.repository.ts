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

  async create(input: CreateUserInput, context: AuditContext): Promise<UserRow> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await this.setAuditContext(client, context);
      const result = await client.query<RawUserRow>(
        `INSERT INTO security.users (display_name, email, password_hash, role, status, must_change_password)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${userColumns}`,
        [input.displayName, input.email, input.passwordHash, input.role, input.status, input.mustChangePassword]
      );
      await client.query('COMMIT');
      return mapRow(result.rows[0]!);
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

  // Persists only the new hash; the plaintext never reaches this layer (the
  // caller must have already hashed it). mustChangePassword is set exactly
  // as the caller intends — the repository does not infer it.
  async updatePassword(userId: string, passwordHash: string, mustChangePassword: boolean, context: AuditContext): Promise<UserRow | null> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await this.setAuditContext(client, context);
      const result = await client.query<RawUserRow>(
        `UPDATE security.users
         SET password_hash = $1, must_change_password = $2
         WHERE user_id = $3
         RETURNING ${userColumns}`,
        [passwordHash, mustChangePassword, userId]
      );
      await client.query('COMMIT');
      return result.rows[0] ? mapRow(result.rows[0]) : null;
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
