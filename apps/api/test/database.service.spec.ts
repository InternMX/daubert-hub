import { describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../src/database/database.service';

const config = {
  get: () => ({ host: 'localhost', port: 5432, name: 'daubert_hub_test', user: 'test', password: 'not-production' })
};

describe('DatabaseService', () => {
  it('maps configuration, executes queries, and closes its pool', async () => {
    const service = new DatabaseService(config as never);
    const pool = (service as unknown as { pool: { query: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> } }).pool;
    pool.query = vi.fn().mockResolvedValue({ rows: [{ value: 1 }] });
    pool.end = vi.fn().mockResolvedValue(undefined);
    await expect(service.query<{ value: number }>('SELECT 1')).resolves.toEqual([{ value: 1 }]);
    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
    await service.onModuleDestroy();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it('returns false when PostgreSQL is unavailable', async () => {
    const service = new DatabaseService(config as never);
    const pool = (service as unknown as { pool: { query: ReturnType<typeof vi.fn> } }).pool;
    pool.query = vi.fn().mockRejectedValue(new Error('connection refused'));
    await expect(service.checkConnection()).resolves.toBe(false);
  });

  it('reports a successful PostgreSQL connection after a query succeeds', async () => {
    const service = new DatabaseService(config as never);
    const pool = (service as unknown as { pool: { query: ReturnType<typeof vi.fn> } }).pool;
    pool.query = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
    await expect(service.checkConnection()).resolves.toBe(true);
  });
});
