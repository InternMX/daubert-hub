// One-off production bootstrap for the very first ADMIN account in
// daubert_global.
//
// This is a SEPARATE script from scripts/bootstrap-admin.ts, which remains
// TEST-only (restricted to daubert_hub_test) and is not modified or
// generalized by this file. There is deliberately NO public registration
// endpoint and NO HTTP bootstrap route anywhere in the application — this
// script is the only way the first production ADMIN account gets created,
// before any ADMIN exists to create one through Daubert Hub's own
// administration UI.
//
// PRODUCTION-only: refuses to run against anything but daubert_global,
// verified twice (the configured URL's database name, and a live SELECT
// current_database()), and additionally verifies the connected PostgreSQL
// role is exactly daubert_hub_app (the least-privilege production Hub
// application role — see
// 20260827_005_automation_hub_permissions_prod.up.sql /
// 20260911_003_automation_trigger_requests_prod.up.sql), that
// security.users and security.sessions both exist, and that security.users
// currently has zero rows. All six guards run before the password is even
// requested, and before any write. This script is for the INITIAL
// production ADMIN only — refuses outright once any user exists; every
// subsequent user is created through Daubert Hub's normal ADMIN
// functionality (POST /api/users).
//
// Usage:
//   PROD_DATABASE_URL="postgres://daubert_hub_app:...@host:5432/daubert_global" \
//   BOOTSTRAP_ADMIN_DISPLAY_NAME="..." BOOTSTRAP_ADMIN_EMAIL="..." \
//     npm run security:bootstrap-admin:prod --workspace=@daubert/api
//
// The password is read from BOOTSTRAP_ADMIN_PASSWORD if set (a temporary
// environment variable — never a CLI argument, which would be visible in
// shell history / process listings), or otherwise prompted interactively
// with input hidden from the terminal. Neither the plaintext password, the
// resulting hash, PROD_DATABASE_URL, nor the database password is ever
// printed or logged.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../src/database/database.service';
import type { EnvironmentConfig } from '../src/config/environment';
import { PasswordService } from '../src/security/password.service';
import { UsersRepository } from '../src/security/users.repository';
import { UserEmailConflictError, UsersService, UserValidationError } from '../src/security/users.service';
import { PasswordPolicyError } from '../src/security/password-policy';
import type { SafeUser } from '../src/security/users.types';

export const EXPECTED_DATABASE = 'daubert_global';
export const EXPECTED_ROLE = 'daubert_hub_app';
export const PROD_BOOTSTRAP_ORIGIN = 'DAUBERT_HUB_BOOTSTRAP_PROD';

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
// redirect a production bootstrap at the wrong database.
export function guardedProdDatabaseUrl(): URL {
  const value = process.env.PROD_DATABASE_URL;
  if (!value) throw new Error('PROD_DATABASE_URL must be set. This production bootstrap never falls back to TEST_DATABASE_URL or DB_* variables.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('PROD_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  const databaseName = decodeURIComponent(url.pathname).replace(/^\//, '');
  if (databaseName !== EXPECTED_DATABASE) {
    throw new Error(`Production bootstrap is restricted to ${EXPECTED_DATABASE}; PROD_DATABASE_URL points at "${databaseName}".`);
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
// technically perform the insert.
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

// Guards 4 and 5: both tables this bootstrap depends on (directly, and
// transitively via UsersRepository.create's session-adjacent schema) must
// already exist from the applied production security migrations.
export async function assertSecuritySchemaReady(database: QueryableDatabase): Promise<void> {
  const [row] = await database.query<{ users_table_exists: boolean; sessions_table_exists: boolean }>(
    `SELECT to_regclass('security.users') IS NOT NULL AS users_table_exists,
            to_regclass('security.sessions') IS NOT NULL AS sessions_table_exists`
  );
  if (!row?.users_table_exists) throw new Error('Refusing to write: security.users does not exist.');
  if (!row?.sessions_table_exists) throw new Error('Refusing to write: security.sessions does not exist.');
}

// Guard 6: this script is for the INITIAL production ADMIN only. Once any
// user exists, every subsequent account must be created through Daubert
// Hub's own ADMIN administration (POST /api/users) — never by re-running
// this bootstrap.
export async function assertUsersTableEmpty(database: QueryableDatabase): Promise<void> {
  const [row] = await database.query<{ user_count: number }>('SELECT count(*)::int AS user_count FROM security.users');
  if ((row?.user_count ?? 0) !== 0) {
    throw new Error(
      'Production bootstrap refused: security.users is not empty. Create additional users through Daubert Hub administration.'
    );
  }
}

// Runs every mandatory guard, in the required order, before the caller may
// request the ADMIN password or perform any write.
export async function assertProductionBootstrapGuards(database: QueryableDatabase): Promise<void> {
  await assertLiveDatabaseAndRole(database);
  await assertSecuritySchemaReady(database);
  await assertUsersTableEmpty(database);
}

export interface BootstrapAdminInput {
  displayName: string;
  email: string;
  password: string;
}

// The recoverable core: delegates entirely to the existing UsersService,
// which owns password hashing (PasswordService/Argon2id), validation, the
// ACTIVE/must_change_password=true contract for a provisioned account, and
// the atomic insert (UsersRepository.create). This script never hashes a
// password itself and never writes security.users directly. actorUserId/
// actorUserEmail are null — there is no authenticated caller yet.
export async function createProductionAdmin(users: Pick<UsersService, 'createUser'>, input: BootstrapAdminInput): Promise<SafeUser> {
  return users.createUser(
    { displayName: input.displayName, email: input.email, password: input.password, role: 'ADMIN' },
    { requestId: randomUUID(), origin: PROD_BOOTSTRAP_ORIGIN, actorUserId: null, actorUserEmail: null }
  );
}

function promptHiddenPassword(promptText: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error('BOOTSTRAP_ADMIN_PASSWORD must be set when stdin is not an interactive terminal.'));
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

async function readPassword(): Promise<string> {
  const fromEnv = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (fromEnv !== undefined) return fromEnv;
  return promptHiddenPassword('Production ADMIN password (input hidden): ');
}

async function run(): Promise<void> {
  const displayName = process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME?.trim();
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
  if (!displayName) throw new Error('BOOTSTRAP_ADMIN_DISPLAY_NAME is required.');
  if (!email) throw new Error('BOOTSTRAP_ADMIN_EMAIL is required.');

  const url = guardedProdDatabaseUrl();
  const database = buildDatabaseService(url);

  try {
    // All six mandatory guards run — and must pass — before the password
    // prompt and before any write (PROD1 §1).
    await assertProductionBootstrapGuards(database);

    const password = await readPassword();

    const repository = new UsersRepository(database);
    const passwords = new PasswordService();
    const users = new UsersService(repository, passwords);

    const created = await createProductionAdmin(users, { displayName, email, password });

    // Safe fields only — never the password, its hash, PROD_DATABASE_URL,
    // or the database password.
    console.log('Production ADMIN created:');
    console.log(JSON.stringify({
      id: created.id,
      displayName: created.displayName,
      email: created.email,
      role: created.role,
      status: created.status,
      mustChangePassword: created.mustChangePassword
    }, null, 2));
  } catch (error) {
    if (error instanceof UserEmailConflictError) {
      console.error(`Production bootstrap refused: a user with email "${email}" already exists. No changes were made.`);
      process.exitCode = 1;
      return;
    }
    if (error instanceof UserValidationError || error instanceof PasswordPolicyError) {
      console.error(`Production bootstrap refused: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await database.onModuleDestroy();
  }
}

// Only auto-run as the CLI entry point — importing this module (e.g. from a
// unit test, to exercise the exported guard/creation functions above
// against fakes) must never trigger a real database connection attempt as
// a side effect.
if (require.main === module) {
  run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Production bootstrap failed.');
    process.exitCode = 1;
  });
}
