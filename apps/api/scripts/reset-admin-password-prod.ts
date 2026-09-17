// Production ADMIN password-recovery CLI for daubert_global.
//
// This is a SEPARATE script from scripts/reset-admin-password.ts, which
// remains TEST-only (restricted to daubert_hub_test) and is not modified by
// this file. Solves exactly one situation: the production Hub's only
// ADMIN account (internmx@daubertcromwell.com at the time this script was
// written) forgot the bootstrap password before a second ADMIN existed to
// reset it through the Users API (POST /api/users/:userId/reset-password is
// ADMIN-only). This is NOT an HTTP recovery endpoint, NOT an authentication
// bypass, and it never writes a plaintext password to SQL — it reuses the
// exact same PasswordService Argon2id hashing and the exact same atomic
// UsersRepository.adminResetPassword transaction (password_hash +
// must_change_password=true + session revocation, in one transaction) that
// the ADMIN-only HTTP endpoint uses. Role/email/display name/status are
// never touched, and an INACTIVE account is never implicitly reactivated —
// adminResetPassword doesn't write status. This script never creates a
// user.
//
// PRODUCTION-only: refuses to run against anything but daubert_global,
// verified twice (the configured URL's database name, and a live SELECT
// current_database()), additionally verifies the connected PostgreSQL role
// is exactly daubert_hub_app (the least-privilege production Hub
// application role — see
// 20260827_005_automation_hub_permissions_prod.up.sql /
// 20260911_003_automation_trigger_requests_prod.up.sql), and requires both
// security.users and security.sessions to exist. All guards run before the
// password is even requested, and before any write.
//
// Usage:
//   PROD_DATABASE_URL="postgres://daubert_hub_app:...@host:5432/daubert_global" \
//   RECOVERY_ADMIN_EMAIL="internmx@daubertcromwell.com" \
//     npm run security:reset-admin-password:prod --workspace=@daubert/api
//
// The new temporary password is read from RECOVERY_ADMIN_PASSWORD if
// explicitly set (a temporary environment variable for automation/testing
// ONLY — never printed or logged; unset/remove it from the shell/CI
// environment immediately after use), or otherwise prompted interactively
// with input hidden from the terminal. Neither the plaintext password, the
// resulting hash, PROD_DATABASE_URL, nor the database password is ever
// printed or logged.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../src/database/database.service';
import type { EnvironmentConfig } from '../src/config/environment';
import type { AuditContext } from '../src/security/audit-context';
import { PasswordService } from '../src/security/password.service';
import { assertPasswordPolicy, PasswordPolicyError } from '../src/security/password-policy';
import { UsersRepository } from '../src/security/users.repository';
import { toSafeUser, type SafeUser } from '../src/security/users.types';

export const EXPECTED_DATABASE = 'daubert_global';
export const EXPECTED_ROLE = 'daubert_hub_app';
export const RECOVERY_ORIGIN = 'DAUBERT_HUB_ADMIN_RECOVERY_PROD';

// Control characters recognized while reading a hidden password from stdin,
// referenced by code point rather than embedded as raw bytes in this file.
const KEY_ENTER = '\r';
const KEY_NEWLINE = '\n';
const KEY_EOF = String.fromCharCode(4); // Ctrl+D
const KEY_INTERRUPT = String.fromCharCode(3); // Ctrl+C
const KEY_BACKSPACE = String.fromCharCode(127); // Delete/Backspace on most terminals
const KEY_BACKSPACE_ALT = '\b';

// Guard 1: the configured URL's own database name. Deliberately reads ONLY
// PROD_DATABASE_URL — never TEST_DATABASE_URL, never any DB_* variable — so
// a shell that happens to have TEST/dev variables set can never silently
// redirect a production recovery at the wrong database.
export function guardedProdDatabaseUrl(): URL {
  const value = process.env.PROD_DATABASE_URL;
  if (!value) throw new Error('PROD_DATABASE_URL must be set. This production recovery never falls back to TEST_DATABASE_URL or DB_* variables.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('PROD_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  const databaseName = decodeURIComponent(url.pathname).replace(/^\//, '');
  if (databaseName !== EXPECTED_DATABASE) {
    throw new Error(`Production recovery is restricted to ${EXPECTED_DATABASE}; PROD_DATABASE_URL points at "${databaseName}".`);
  }
  return url;
}

export function buildDatabaseService(url: URL): DatabaseService {
  const config = {
    // Only the "database" key is ever read by DatabaseService; a full
    // ConfigService is unnecessary machinery for a standalone CLI script.
    get: (key: string) => {
      if (key !== 'database') throw new Error(`Unexpected config key requested: ${key}`);
      return {
        host: url.hostname,
        port: Number(url.port || 5432),
        name: decodeURIComponent(url.pathname).replace(/^\//, ''),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password)
      };
    }
  } as unknown as ConfigService<EnvironmentConfig, true>;
  return new DatabaseService(config);
}

interface QueryableDatabase {
  query<Row extends Record<string, unknown>>(text: string, values?: unknown[]): Promise<Row[]>;
}

// Guards 2 and 3: the LIVE connection must independently confirm both the
// database name (never trust the URL string alone — it could be stale or
// pointed at a tunnel/replica) and that the connected PostgreSQL role is
// exactly the least-privilege production Hub role. Any other role — a
// superuser, a migration role, anything else — is refused even if it could
// technically perform the update.
export async function assertLiveDatabaseAndRole(database: QueryableDatabase): Promise<void> {
  const [row] = await database.query<{ database_name: string; role_name: string }>(
    'SELECT current_database() AS database_name, current_user AS role_name'
  );
  if (row?.database_name !== EXPECTED_DATABASE) {
    throw new Error(`Refusing to write: live connection reports database "${row?.database_name}", expected "${EXPECTED_DATABASE}".`);
  }
  if (row?.role_name !== EXPECTED_ROLE) {
    throw new Error(`Refusing to write: live connection reports PostgreSQL role "${row?.role_name}", expected "${EXPECTED_ROLE}".`);
  }
}

// Guards 4 and 5: both tables this recovery depends on (directly, and
// transitively via UsersRepository.adminResetPassword's session revocation)
// must already exist from the applied production security migrations.
export async function assertSecuritySchemaReady(database: QueryableDatabase): Promise<void> {
  const [row] = await database.query<{ users_table_exists: boolean; sessions_table_exists: boolean }>(
    `SELECT to_regclass('security.users') IS NOT NULL AS users_table_exists,
            to_regclass('security.sessions') IS NOT NULL AS sessions_table_exists`
  );
  if (!row?.users_table_exists) throw new Error('Refusing to write: security.users does not exist.');
  if (!row?.sessions_table_exists) throw new Error('Refusing to write: security.sessions does not exist.');
}

// Runs every mandatory guard, in the required order, before the caller may
// request the new password or perform any write.
export async function assertProductionRecoveryGuards(database: QueryableDatabase): Promise<void> {
  await assertLiveDatabaseAndRole(database);
  await assertSecuritySchemaReady(database);
}

// Raised for every "refuse safely, change nothing" condition the operator
// needs a clear message for (target missing, target not ADMIN, or the
// atomic update racing with a concurrent deletion). Kept distinct from
// PasswordPolicyError so run() can report both without conflating them.
export class RecoveryTargetError extends Error {}

export interface RecoveryDependencies {
  repository: Pick<UsersRepository, 'findByEmail' | 'adminResetPassword'>;
  passwords: Pick<PasswordService, 'hashPassword'>;
}

// The recoverable core: identify the ADMIN by normalized email (findByEmail
// already matches lower(btrim(email))), require it to exist and be ADMIN,
// enforce the existing password policy, hash with the existing
// PasswordService parameters, and delegate the actual write to the exact
// same atomic transaction the HTTP admin-reset endpoint uses (hashes with
// Argon2id, sets must_change_password=true, and revokes every existing
// session for the target, atomically). Never creates a user, never changes
// role/email/displayName/status.
export async function recoverProductionAdminPassword(deps: RecoveryDependencies, email: string, newPassword: string): Promise<SafeUser> {
  const target = await deps.repository.findByEmail(email);
  if (!target) throw new RecoveryTargetError('No se encontró ningún usuario con ese correo electrónico. No se realizaron cambios.');
  if (target.role !== 'ADMIN') throw new RecoveryTargetError('La cuenta indicada no tiene rol ADMIN. No se realizaron cambios.');

  assertPasswordPolicy(newPassword);
  const passwordHash = await deps.passwords.hashPassword(newPassword);

  const context: AuditContext = { requestId: randomUUID(), origin: RECOVERY_ORIGIN, actorUserId: null, actorUserEmail: null };
  const updated = await deps.repository.adminResetPassword(target.id, passwordHash, context);
  if (!updated) throw new RecoveryTargetError('No fue posible completar la recuperación: el usuario ya no existe. No se realizaron cambios.');
  return toSafeUser(updated);
}

function promptHiddenPassword(promptText: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error('RECOVERY_ADMIN_PASSWORD must be set when stdin is not an interactive terminal.'));
      return;
    }
    process.stdout.write(promptText);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let input = '';
    const cleanup = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    };
    const onData = (char: string): void => {
      if (char === KEY_NEWLINE || char === KEY_ENTER || char === KEY_EOF) {
        cleanup();
        process.stdout.write('\n');
        resolve(input);
        return;
      }
      if (char === KEY_INTERRUPT) {
        cleanup();
        process.stdout.write('\n');
        reject(new Error('Aborted.'));
        return;
      }
      if (char === KEY_BACKSPACE || char === KEY_BACKSPACE_ALT) {
        input = input.slice(0, -1);
        return;
      }
      input += char;
    };
    stdin.on('data', onData);
  });
}

async function readNewPassword(): Promise<string> {
  const fromEnv = process.env.RECOVERY_ADMIN_PASSWORD;
  if (fromEnv !== undefined) return fromEnv;
  return promptHiddenPassword('New temporary password for the production ADMIN (input hidden): ');
}

async function run(): Promise<void> {
  const email = process.env.RECOVERY_ADMIN_EMAIL?.trim();
  if (!email) throw new Error('RECOVERY_ADMIN_EMAIL is required.');

  const url = guardedProdDatabaseUrl();
  const database = buildDatabaseService(url);

  try {
    // Every mandatory guard runs — and must pass — before the password
    // prompt and before any write.
    await assertProductionRecoveryGuards(database);

    const repository = new UsersRepository(database);
    const passwords = new PasswordService();

    const newPassword = await readNewPassword();

    await recoverProductionAdminPassword({ repository, passwords }, email, newPassword);

    // Safe output only — never the plaintext password, its hash,
    // PROD_DATABASE_URL, or the database password.
    console.log('Production ADMIN password recovery completed.');
    console.log('Sessions revoked.');
    console.log('Password change required on next login.');
  } catch (error) {
    if (error instanceof RecoveryTargetError || error instanceof PasswordPolicyError) {
      console.error(`Production recovery refused: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await database.onModuleDestroy();
  }
}

// Only auto-run as the CLI entry point — importing this module (e.g. from a
// unit test, to exercise the exported guard/recovery functions above
// against fakes) must never trigger a real database connection attempt as
// a side effect.
if (require.main === module) {
  run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Production recovery failed.');
    process.exitCode = 1;
  });
}
