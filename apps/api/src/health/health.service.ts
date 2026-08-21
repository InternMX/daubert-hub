import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface HealthResponse {
  status: 'ok';
  database?: 'connected' | 'unavailable';
}

@Injectable()
export class HealthService {
  constructor(private readonly database: DatabaseService) {}

  async getHealth(): Promise<HealthResponse> {
    const connected = await this.database.checkConnection();
    return connected ? { status: 'ok', database: 'connected' } : { status: 'ok', database: 'unavailable' };
  }
}
