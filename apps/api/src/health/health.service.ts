import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';

export type RuntimeEnvironment = 'PRODUCTION' | 'TEST' | 'UNKNOWN';

export interface HealthResponse {
  status: 'ok';
  database?: 'connected' | 'unavailable';
  environment?: RuntimeEnvironment;
}

interface CurrentDatabaseRow extends QueryResultRow {
  database_name: string;
}

@Injectable()
export class HealthService {
  constructor(private readonly database: DatabaseService) {}

  async getHealth(): Promise<HealthResponse> {
    try {
      const [result] = await this.database.query<CurrentDatabaseRow>(
        'SELECT current_database() AS database_name'
      );
      const environment: RuntimeEnvironment = result?.database_name === 'daubert_global'
        ? 'PRODUCTION'
        : result?.database_name === 'daubert_hub_test' ? 'TEST' : 'UNKNOWN';

      return { status: 'ok', database: 'connected', environment };
    } catch {
      return { status: 'ok', database: 'unavailable' };
    }
  }
}
