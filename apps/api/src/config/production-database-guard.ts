// Startup guard: a NON-production API process must never run against the PRODUCTION database.
//
// Why this exists: before this guard, the only protection was the opt-in EXPECTED_DATABASE_NAME that
// the safe dev launcher (scripts/dev-test-only.cjs) supplies. Starting the API any other way
// (`nest start`, `node dist/src/main.js`, a mis-edited apps/api/.env, a DB_* override in the shell)
// connected to whatever DB_* said — including daubert_global.
//
// "Production runtime" is deliberately NOT decided by NODE_ENV alone (anyone can export it). It
// requires BOTH of the signals the real PRODUCTION container already has, with no new variable to
// configure: NODE_ENV=production (baked into docker/api.Dockerfile) AND running inside a container
// (/.dockerenv, or /run/.containerenv for Podman). A host process with NODE_ENV=production is
// therefore still treated as non-production and refused for daubert_global.
//
// What it does NOT do (documented limitation): it cannot tell the PRODUCTION container apart from
// another container that is deliberately given NODE_ENV=production and PRODUCTION credentials. That
// last line of defence has to be the database itself (separate credentials, CONNECT privileges).
//
// Error messages carry only database/role NAMES and error codes — never a connection string, a
// password, a host or the raw driver message (which can echo user names or addresses).
import { existsSync } from 'node:fs';
import type { QueryResultRow } from 'pg';
import { assertLiveDatabaseMatches } from './live-database-guard';

export const PRODUCTION_DATABASE_NAME = 'daubert_global';
export const PRODUCTION_DATABASE_ROLE = 'daubert_hub_app';

export interface RuntimeSignals {
  nodeEnv: string | undefined;
  inContainer: boolean;
}

export interface ConfiguredDatabase {
  name: string;
  user: string;
}

interface LiveDatabaseRow extends QueryResultRow {
  database_name: string | null;
  role_name: string | null;
}

export interface QueryableDatabase {
  query<Row extends LiveDatabaseRow>(text: string): Promise<Row[]>;
}

export class ProductionDatabaseGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionDatabaseGuardError';
  }
}

const normalize = (value: string | null | undefined): string => (value ?? '').trim().toLowerCase();

export function isProductionDatabaseName(name: string | null | undefined): boolean {
  return normalize(name) === PRODUCTION_DATABASE_NAME;
}

export function isProductionDatabaseRole(role: string | null | undefined): boolean {
  return normalize(role) === PRODUCTION_DATABASE_ROLE;
}

export function detectContainer(fileExists: (path: string) => boolean = existsSync): boolean {
  return fileExists('/.dockerenv') || fileExists('/run/.containerenv');
}

export function isProductionRuntime(signals: RuntimeSignals): boolean {
  return signals.nodeEnv === 'production' && signals.inContainer;
}

// Static check on the configured DB_* values. Runs before any connection is attempted.
export function assertConfiguredDatabaseAllowed(configured: ConfiguredDatabase, runtime: RuntimeSignals): void {
  if (isProductionRuntime(runtime)) return;
  if (isProductionDatabaseName(configured.name)) {
    throw new ProductionDatabaseGuardError(`Refusing to start: this is not the production runtime and DB_NAME points at the production database "${PRODUCTION_DATABASE_NAME}". Use daubert_hub_test for development and tests.`);
  }
  if (isProductionDatabaseRole(configured.user)) {
    throw new ProductionDatabaseGuardError(`Refusing to start: this is not the production runtime and DB_USER is the production role "${PRODUCTION_DATABASE_ROLE}". Use the TEST role for development and tests.`);
  }
}

// Check against what the connection REALLY reached (current_database()/current_user), which does not
// depend on trusting the configured names.
export function assertLiveDatabaseAllowed(live: { databaseName: string | null | undefined; roleName: string | null | undefined }, configured: ConfiguredDatabase, runtime: RuntimeSignals): void {
  if (isProductionRuntime(runtime)) return;
  if (isProductionDatabaseName(live.databaseName)) {
    throw new ProductionDatabaseGuardError(`Refusing to start: this is not the production runtime but the live connection reports the production database "${PRODUCTION_DATABASE_NAME}".`);
  }
  if (isProductionDatabaseRole(live.roleName)) {
    throw new ProductionDatabaseGuardError(`Refusing to start: this is not the production runtime but the live connection uses the production role "${PRODUCTION_DATABASE_ROLE}".`);
  }
  if (normalize(live.databaseName) !== normalize(configured.name)) {
    throw new ProductionDatabaseGuardError(`Refusing to start: DB_NAME is "${configured.name}" but the live connection reports "${live.databaseName ?? '(unknown)'}".`);
  }
}

export interface StartupGuardOptions {
  configured: ConfiguredDatabase;
  runtime: RuntimeSignals;
  // Opt-in strict expectation supplied by the dev launcher (EXPECTED_DATABASE_NAME). Applies in every runtime.
  expectedDatabaseName?: string;
}

export interface StartupGuardResult {
  // Name of the database the live connection reported, or undefined when no live check was needed.
  liveDatabaseName: string | undefined;
}

// To be awaited BEFORE the API starts listening. Throws ProductionDatabaseGuardError (or the existing
// "Refusing to start" error for EXPECTED_DATABASE_NAME) to make the caller close the app and exit.
//
// Production runtime: nothing new happens (no extra query, no new failure mode) — PRODUCTION behaviour
// is unchanged, and it still starts when the database is temporarily unavailable. Only the pre-existing
// opt-in EXPECTED_DATABASE_NAME check keeps applying if it is set.
export async function verifyDatabaseBeforeListening(database: QueryableDatabase, options: StartupGuardOptions): Promise<StartupGuardResult> {
  const { configured, runtime } = options;
  const expected = options.expectedDatabaseName?.trim() || undefined;
  const production = isProductionRuntime(runtime);

  assertConfiguredDatabaseAllowed(configured, runtime);
  if (production && !expected) return { liveDatabaseName: undefined };

  let row: LiveDatabaseRow | undefined;
  try {
    [row] = await database.query<LiveDatabaseRow>('SELECT current_database() AS database_name, current_user AS role_name');
  } catch (error) {
    const code = typeof (error as { code?: unknown } | null)?.code === 'string' ? ` (error code ${(error as { code: string }).code})` : '';
    throw new ProductionDatabaseGuardError(`Refusing to start: could not verify the live database${code}.`);
  }

  assertLiveDatabaseAllowed({ databaseName: row?.database_name, roleName: row?.role_name }, configured, runtime);
  if (expected) assertLiveDatabaseMatches(row?.database_name, expected);
  return { liveDatabaseName: row?.database_name ?? undefined };
}
