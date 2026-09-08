// Offline ADMIN password-recovery CLI for Daubert Hub TEST.
//
// Solves exactly one situation: the first real TEST ADMIN forgot their
// password before a second ADMIN existed to reset it through the Users API
// (POST /api/users/:userId/reset-password is ADMIN-only). This is NOT an
// HTTP recovery endpoint, NOT an authentication bypass, and it never writes
// a plaintext password to SQL — it reuses the exact same PasswordService
// Argon2id hashing and the exact same atomic UsersRepository.adminResetPassword
// transaction (password_hash + must_change_password=true + session
// revocation, in one transaction) that the ADMIN-only HTTP endpoint uses.
// Role/email/display name/status are never touched, and an INACTIVE account
// is never implicitly reactivated — adminResetPassword doesn't write status.
//
// TEST-only: refuses to run against anything but daubert_hub_test, verified
// twice (the configured URL's database name, and a live SELECT
// current_database()) before any write — the same guarded pattern as
// bootstrap-admin.ts and every integration runner in apps/api/test/. There is
// no production recovery mode, and daubert_global is never addressed.
//
// Usage:
//   RECOVERY_ADMIN_EMAIL="admin@example.test" \
//     npm run security:reset-admin-password --workspace=@daubert/api
//
// The new temporary password is read from RECOVERY_ADMIN_PASSWORD if set (a
// temporary environment variable for automation/testing ONLY — never
// printed or logged; unset/remove it from the shell/CI environment
// immediately after use), or otherwise prompted interactively with input
// hidden from the terminal.
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

const EXPECTED_DATABASE = 'daubert_hub_test';
const RECOVERY_ORIGIN = 'DAUBERT_HUB_ADMIN_RECOVERY';

// Control characters recognized while reading a hidden password from stdin,
// referenced by code point rather than embedded as raw bytes in this file.
const KEY_ENTER = '\r';
const KEY_NEWLINE = '\n';
const KEY_EOF = String.fromCharCode(4); // Ctrl+D
const KEY_INTERRUPT = String.fromCharCode(3); // Ctrl+C
const KEY_BACKSPACE = String.fromCharCode(127); // Delete/Backspace on most terminals
const KEY_BACKSPACE_ALT = '\b';

export function guardedTestDatabaseUrl(): URL {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error('TEST_DATABASE_URL must be set. This recovery script never falls back to DB_* variables.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  const databaseName = decodeURIComponent(url.pathname).replace(/^\//, '');
  if (databaseName !== EXPECTED_DATABASE) {
    throw new Error(`Recovery is restricted to ${EXPECTED_DATABASE}; TEST_DATABASE_URL points at "${databaseName}".`);
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

export async function assertLiveDatabase(database: DatabaseService): Promise<void> {
  const [row] = await database.query<{ name: string }>('SELECT current_database() AS name');
  if (row?.name !== EXPECTED_DATABASE) {
    throw new Error(`Refusing to write: live connection reports database "${row?.name}", expected "${EXPECTED_DATABASE}".`);
  }
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
// enforce the existing password policy, hash with the existing PasswordService
// parameters, and delegate the actual write to the exact same atomic
// transaction the HTTP admin-reset endpoint uses. Never creates a user, never
// changes role/email/displayName/status. actorUserId/actorUserEmail are null —
// this is never attributed to the target account itself.
export async function recoverAdminPassword(deps: RecoveryDependencies, email: string, newPassword: string): Promise<SafeUser> {
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
  return promptHiddenPassword('New temporary password for the ADMIN (input hidden): ');
}

async function run(): Promise<void> {
  const email = process.env.RECOVERY_ADMIN_EMAIL?.trim();
  if (!email) throw new Error('RECOVERY_ADMIN_EMAIL is required.');

  const url = guardedTestDatabaseUrl();
  const database = buildDatabaseService(url);

  try {
    await assertLiveDatabase(database);

    const repository = new UsersRepository(database);
    const passwords = new PasswordService();

    const newPassword = await readNewPassword();

    await recoverAdminPassword({ repository, passwords }, email, newPassword);

    // Safe output only — never the plaintext password, its hash, the
    // connection URL, or any credential.
    console.log('ADMIN password recovery completed.');
    console.log('Sessions revoked.');
    console.log('Password change required on next login.');
  } catch (error) {
    if (error instanceof RecoveryTargetError || error instanceof PasswordPolicyError) {
      console.error(`Recovery refused: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await database.onModuleDestroy();
  }
}

// Only auto-run as the CLI entry point — importing this module (e.g. from a
// unit test, to exercise the exported functions above against fakes) must
// never trigger a real database connection attempt as a side effect.
if (require.main === module) {
  run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Recovery failed.');
    process.exitCode = 1;
  });
}
