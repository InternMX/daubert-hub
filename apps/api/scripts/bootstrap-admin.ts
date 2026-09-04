// Manual, one-off bootstrap for the very first ADMIN account.
//
// There is deliberately NO public registration endpoint and NO "first
// caller becomes admin" HTTP behavior anywhere in the application — this
// script is the only way an ADMIN account gets created before any ADMIN
// exists to create one through a future admin UI.
//
// TEST-only for this phase: it refuses to run against anything but
// daubert_hub_test, verified twice (the configured URL's database name, and
// a live SELECT current_database()) before any write, following the same
// guarded pattern used by every integration runner in apps/api/test/.
//
// Usage:
//   BOOTSTRAP_ADMIN_DISPLAY_NAME="..." BOOTSTRAP_ADMIN_EMAIL="..." \
//     npm run security:bootstrap-admin --workspace=@daubert/api
//
// The password is read from BOOTSTRAP_ADMIN_PASSWORD if set (a temporary
// environment variable — never a CLI argument, which would be visible in
// shell history / process listings), or otherwise prompted interactively
// with input hidden from the terminal. Neither the plaintext password nor
// the resulting hash is ever printed or logged.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../src/database/database.service';
import type { EnvironmentConfig } from '../src/config/environment';
import { PasswordService } from '../src/security/password.service';
import { UsersRepository } from '../src/security/users.repository';
import { UserEmailConflictError, UsersService, UserValidationError } from '../src/security/users.service';
import { PasswordPolicyError } from '../src/security/password-policy';

const EXPECTED_DATABASE = 'daubert_hub_test';

// Control characters recognized while reading a hidden password from stdin,
// referenced by code point rather than embedded as raw bytes in this file.
const KEY_ENTER = '\r';
const KEY_NEWLINE = '\n';
const KEY_EOF = String.fromCharCode(4); // Ctrl+D
const KEY_INTERRUPT = String.fromCharCode(3); // Ctrl+C
const KEY_BACKSPACE = String.fromCharCode(127); // Delete/Backspace on most terminals
const KEY_BACKSPACE_ALT = '\b';

function guardedTestDatabaseUrl(): URL {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error('TEST_DATABASE_URL must be set. This bootstrap script never falls back to DB_* variables.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  const databaseName = decodeURIComponent(url.pathname).replace(/^\//, '');
  if (databaseName !== EXPECTED_DATABASE) {
    throw new Error(`Bootstrap is restricted to ${EXPECTED_DATABASE}; TEST_DATABASE_URL points at "${databaseName}".`);
  }
  return url;
}

function buildDatabaseService(url: URL): DatabaseService {
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

async function assertLiveDatabase(database: DatabaseService): Promise<void> {
  const [row] = await database.query<{ name: string }>('SELECT current_database() AS name');
  if (row?.name !== EXPECTED_DATABASE) {
    throw new Error(`Refusing to write: live connection reports database "${row?.name}", expected "${EXPECTED_DATABASE}".`);
  }
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
  return promptHiddenPassword('Admin password (input hidden): ');
}

async function run(): Promise<void> {
  const displayName = process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME?.trim();
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
  if (!displayName) throw new Error('BOOTSTRAP_ADMIN_DISPLAY_NAME is required.');
  if (!email) throw new Error('BOOTSTRAP_ADMIN_EMAIL is required.');

  const url = guardedTestDatabaseUrl();
  const database = buildDatabaseService(url);

  try {
    await assertLiveDatabase(database);

    const password = await readPassword();

    const repository = new UsersRepository(database);
    const passwords = new PasswordService();
    const users = new UsersService(repository, passwords);

    const created = await users.createUser(
      { displayName, email, password, role: 'ADMIN' },
      { requestId: randomUUID(), origin: 'DAUBERT_HUB_BOOTSTRAP', actorUserId: null, actorUserEmail: null }
    );

    // Safe fields only — never the password or its hash.
    console.log('ADMIN created:');
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
      console.error(`Bootstrap refused: a user with email "${email}" already exists. No changes were made.`);
      process.exitCode = 1;
      return;
    }
    if (error instanceof UserValidationError || error instanceof PasswordPolicyError) {
      console.error(`Bootstrap refused: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Bootstrap failed.');
  process.exitCode = 1;
});
