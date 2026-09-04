import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface HealthResponse {
  status: 'ok';
  database?: 'connected' | 'unavailable';
}

// Public, unauthenticated endpoint (see HealthController) — kept deliberately
// minimal. It used to also report `environment: 'PRODUCTION' | 'TEST' |
// 'UNKNOWN'` derived from current_database(); that unauthenticated
// environment/database-name fingerprinting was removed. The Docker
// healthcheck (deploy/README.md) only ever depended on `"database":
// "connected"`, which is preserved unchanged.
@Injectable()
export class HealthService {
  constructor(private readonly database: DatabaseService) {}

  async getHealth(): Promise<HealthResponse> {
    try {
      await this.database.query('SELECT 1');
      return { status: 'ok', database: 'connected' };
    } catch {
      return { status: 'ok', database: 'unavailable' };
    }
  }
}
