import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';

export type RuntimeEnvironment = 'PRODUCTION' | 'TEST' | 'UNKNOWN';

export interface HealthResponse {
  status: 'ok';
  database: 'connected' | 'unavailable';
  environment: RuntimeEnvironment;
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
// returned in the HTTP response.
@Injectable()
export class HealthService {
  constructor(private readonly database: DatabaseService) {}

  async getHealth(): Promise<HealthResponse> {
    try {
      const rows = await this.database.query<CurrentDatabaseRow>('SELECT current_database() AS name');
      return { status: 'ok', database: 'connected', environment: classifyEnvironment(rows[0]?.name) };
    } catch {
      return { status: 'ok', database: 'unavailable', environment: 'UNKNOWN' };
    }
  }
}
