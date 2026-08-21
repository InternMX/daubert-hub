import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import type { EnvironmentConfig } from '../config/environment';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(config: ConfigService<EnvironmentConfig, true>) {
    const database = config.get('database', { infer: true });
    this.pool = new Pool({
      host: database.host,
      port: database.port,
      database: database.name,
      user: database.user,
      password: database.password
    });
  }

  async query<Row extends QueryResultRow>(text: string, values?: unknown[]): Promise<Row[]> {
    const result = values ? await this.pool.query<Row>(text, values) : await this.pool.query<Row>(text);
    return result.rows;
  }

  connect(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async checkConnection(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
