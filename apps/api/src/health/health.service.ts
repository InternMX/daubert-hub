import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { QueryResultRow } from 'pg';
import type { EnvironmentConfig } from '../config/environment';
import { DatabaseService } from '../database/database.service';

export type RuntimeEnvironment = 'PRODUCTION' | 'TEST' | 'UNKNOWN';

export interface HealthResponse {
  status: 'ok';
  database: 'connected' | 'unavailable';
  environment: RuntimeEnvironment;
  // Safe, non-secret build metadata (see EnvironmentConfig['app']). Never
  // the database name, host, user, connection string, filesystem paths, or
  // any other environment variable — only these two deliberately-exposed
  // fields.
  version: string;
  commit: string;
}

interface CurrentDatabaseRow extends QueryResultRow {
  name: string;
}

// Maps the live database name to a coarse environment classification —
// never the raw name itself, which must never leave this function. Any
// database other than these two known names (e.g. a developer's local
// database, or something unexpected) safely reports UNKNOWN rather than
// guessing.
function classifyEnvironment(databaseName: string | undefined): RuntimeEnvironment {
  if (databaseName === 'daubert_hub_test') return 'TEST';
  if (databaseName === 'daubert_global') return 'PRODUCTION';
  return 'UNKNOWN';
}

// Public, unauthenticated endpoint (see HealthController) — kept deliberately
// minimal. `environment` is derived server-side from the live
// current_database() value (a single round trip also used to prove
// connectivity), then immediately collapsed to TEST/PRODUCTION/UNKNOWN — the
// database name itself is never retained past this function, let alone
// returned in the HTTP response. `version`/`commit` come from validated
// config (EnvironmentConfig['app']) — already-resolved, already-safe
// strings, never raw environment variables.
@Injectable()
export class HealthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService<EnvironmentConfig, true>
  ) {}

  async getHealth(): Promise<HealthResponse> {
    const app = this.config.get('app', { infer: true });
    try {
      const rows = await this.database.query<CurrentDatabaseRow>('SELECT current_database() AS name');
      return { status: 'ok', database: 'connected', environment: classifyEnvironment(rows[0]?.name), version: app.version, commit: app.commit };
    } catch {
      return { status: 'ok', database: 'unavailable', environment: 'UNKNOWN', version: app.version, commit: app.commit };
    }
  }
}
