import { describe, expect, it, vi } from 'vitest';
import { HealthService } from '../src/health/health.service';

describe('HealthService', () => {
  it.each([
    ['daubert_global', 'PRODUCTION'],
    ['daubert_hub_test', 'TEST'],
    ['another_database', 'UNKNOWN']
  ] as const)('maps the live %s database to %s', async (databaseName, environment) => {
    const query = vi.fn().mockResolvedValue([{ database_name: databaseName }]);
    const health = new HealthService({ query } as never);

    await expect(health.getHealth()).resolves.toEqual({
      status: 'ok',
      database: 'connected',
      environment
    });
    expect(query).toHaveBeenCalledWith('SELECT current_database() AS database_name');
  });

  it('preserves unavailable health behavior when the live database query fails', async () => {
    const health = new HealthService({ query: vi.fn().mockRejectedValue(new Error('unavailable')) } as never);

    await expect(health.getHealth()).resolves.toEqual({ status: 'ok', database: 'unavailable' });
  });
});
