import { describe, expect, it, vi } from 'vitest';
import { HealthService } from '../src/health/health.service';

describe('HealthService', () => {
  it('classifies the daubert_hub_test database as TEST', async () => {
    const query = vi.fn().mockResolvedValue([{ name: 'daubert_hub_test' }]);
    const health = new HealthService({ query } as never);

    await expect(health.getHealth()).resolves.toEqual({ status: 'ok', database: 'connected', environment: 'TEST' });
    expect(query).toHaveBeenCalledWith('SELECT current_database() AS name');
  });

  it('classifies the daubert_global database as PRODUCTION', async () => {
    const query = vi.fn().mockResolvedValue([{ name: 'daubert_global' }]);
    const health = new HealthService({ query } as never);

    await expect(health.getHealth()).resolves.toEqual({ status: 'ok', database: 'connected', environment: 'PRODUCTION' });
  });

  it('classifies any other database name as UNKNOWN', async () => {
    const query = vi.fn().mockResolvedValue([{ name: 'some_developer_database' }]);
    const health = new HealthService({ query } as never);

    await expect(health.getHealth()).resolves.toEqual({ status: 'ok', database: 'connected', environment: 'UNKNOWN' });
  });

  it('classifies a missing/empty result as UNKNOWN rather than throwing', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const health = new HealthService({ query } as never);

    await expect(health.getHealth()).resolves.toEqual({ status: 'ok', database: 'connected', environment: 'UNKNOWN' });
  });

  it('reports unavailable status and UNKNOWN environment when the live query fails, using a single round trip', async () => {
    const query = vi.fn().mockRejectedValue(new Error('unavailable'));
    const health = new HealthService({ query } as never);

    await expect(health.getHealth()).resolves.toEqual({ status: 'ok', database: 'unavailable', environment: 'UNKNOWN' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('never exposes internal database error details', async () => {
    const health = new HealthService({ query: vi.fn().mockRejectedValue(new Error('connection refused at 10.0.0.5:5432')) } as never);
    const result = await health.getHealth();
    expect(JSON.stringify(result)).not.toMatch(/10\.0\.0\.5|refused/);
  });

  it('never exposes the raw database name in the response, only the classified environment', async () => {
    for (const name of ['daubert_hub_test', 'daubert_global', 'some_developer_database']) {
      const query = vi.fn().mockResolvedValue([{ name }]);
      const health = new HealthService({ query } as never);
      const result = await health.getHealth();
      expect(JSON.stringify(result)).not.toContain(name);
    }
  });

  it('uses exactly one database round trip to determine both connectivity and environment', async () => {
    const query = vi.fn().mockResolvedValue([{ name: 'daubert_hub_test' }]);
    const health = new HealthService({ query } as never);

    await health.getHealth();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
