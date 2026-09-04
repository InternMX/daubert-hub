import { describe, expect, it, vi } from 'vitest';
import { HealthService } from '../src/health/health.service';

describe('HealthService', () => {
  it('reports connected status without any environment/database fingerprinting', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const health = new HealthService({ query } as never);

    await expect(health.getHealth()).resolves.toEqual({ status: 'ok', database: 'connected' });
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('preserves unavailable health behavior when the live database query fails', async () => {
    const health = new HealthService({ query: vi.fn().mockRejectedValue(new Error('unavailable')) } as never);

    await expect(health.getHealth()).resolves.toEqual({ status: 'ok', database: 'unavailable' });
  });

  it('never exposes internal database error details', async () => {
    const health = new HealthService({ query: vi.fn().mockRejectedValue(new Error('connection refused at 10.0.0.5:5432')) } as never);
    const result = await health.getHealth();
    expect(JSON.stringify(result)).not.toMatch(/10\.0\.0\.5|refused/);
  });
});
