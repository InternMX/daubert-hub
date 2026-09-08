import { describe, expect, it, vi } from 'vitest';
import { HealthService } from '../src/health/health.service';

function fakeConfig(app: { version: string; commit: string } = { version: '0.8.0-pilot.1', commit: 'a1b2c3d' }) {
  return { get: vi.fn().mockReturnValue(app) };
}

describe('HealthService', () => {
  it('classifies the daubert_hub_test database as TEST', async () => {
    const query = vi.fn().mockResolvedValue([{ name: 'daubert_hub_test' }]);
    const health = new HealthService({ query } as never, fakeConfig() as never);

    await expect(health.getHealth()).resolves.toEqual({ status: 'ok', database: 'connected', environment: 'TEST', version: '0.8.0-pilot.1', commit: 'a1b2c3d' });
    expect(query).toHaveBeenCalledWith('SELECT current_database() AS name');
  });

  it('classifies the daubert_global database as PRODUCTION', async () => {
    const query = vi.fn().mockResolvedValue([{ name: 'daubert_global' }]);
    const health = new HealthService({ query } as never, fakeConfig() as never);

    await expect(health.getHealth()).resolves.toMatchObject({ status: 'ok', database: 'connected', environment: 'PRODUCTION' });
  });

  it('classifies any other database name as UNKNOWN', async () => {
    const query = vi.fn().mockResolvedValue([{ name: 'some_developer_database' }]);
    const health = new HealthService({ query } as never, fakeConfig() as never);

    await expect(health.getHealth()).resolves.toMatchObject({ status: 'ok', database: 'connected', environment: 'UNKNOWN' });
  });

  it('classifies a missing/empty result as UNKNOWN rather than throwing', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const health = new HealthService({ query } as never, fakeConfig() as never);

    await expect(health.getHealth()).resolves.toMatchObject({ status: 'ok', database: 'connected', environment: 'UNKNOWN' });
  });

  it('reports unavailable status and UNKNOWN environment when the live query fails, using a single round trip', async () => {
    const query = vi.fn().mockRejectedValue(new Error('unavailable'));
    const health = new HealthService({ query } as never, fakeConfig() as never);

    await expect(health.getHealth()).resolves.toMatchObject({ status: 'ok', database: 'unavailable', environment: 'UNKNOWN' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('never exposes internal database error details', async () => {
    const health = new HealthService({ query: vi.fn().mockRejectedValue(new Error('connection refused at 10.0.0.5:5432')) } as never, fakeConfig() as never);
    const result = await health.getHealth();
    expect(JSON.stringify(result)).not.toMatch(/10\.0\.0\.5|refused/);
  });

  it('never exposes the raw database name in the response, only the classified environment', async () => {
    for (const name of ['daubert_hub_test', 'daubert_global', 'some_developer_database']) {
      const query = vi.fn().mockResolvedValue([{ name }]);
      const health = new HealthService({ query } as never, fakeConfig() as never);
      const result = await health.getHealth();
      expect(JSON.stringify(result)).not.toContain(name);
    }
  });

  it('uses exactly one database round trip to determine both connectivity and environment', async () => {
    const query = vi.fn().mockResolvedValue([{ name: 'daubert_hub_test' }]);
    const health = new HealthService({ query } as never, fakeConfig() as never);

    await health.getHealth();
    expect(query).toHaveBeenCalledTimes(1);
  });

  describe('version/commit build metadata', () => {
    it('exposes the semantic version and commit from config, both when connected and when unavailable', async () => {
      const config = fakeConfig({ version: '1.2.3-pilot.4', commit: 'deadbee' });

      const connected = new HealthService({ query: vi.fn().mockResolvedValue([{ name: 'daubert_hub_test' }]) } as never, config as never);
      await expect(connected.getHealth()).resolves.toMatchObject({ version: '1.2.3-pilot.4', commit: 'deadbee' });

      const unavailable = new HealthService({ query: vi.fn().mockRejectedValue(new Error('down')) } as never, config as never);
      await expect(unavailable.getHealth()).resolves.toMatchObject({ version: '1.2.3-pilot.4', commit: 'deadbee' });
    });

    it('falls back safely to "unknown" commit metadata without failing the request', async () => {
      const config = fakeConfig({ version: '0.8.0-pilot.1', commit: 'unknown' });
      const health = new HealthService({ query: vi.fn().mockResolvedValue([{ name: 'daubert_hub_test' }]) } as never, config as never);

      await expect(health.getHealth()).resolves.toMatchObject({ commit: 'unknown' });
    });

    it('never exposes the database name, host, user, or any raw environment variable through version/commit', async () => {
      const config = fakeConfig({ version: '0.8.0-pilot.1', commit: 'a1b2c3d' });
      const health = new HealthService({ query: vi.fn().mockResolvedValue([{ name: 'daubert_hub_test' }]) } as never, config as never);

      const result = await health.getHealth();
      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(/daubert_hub_test|daubert_global|DB_HOST|DB_USER|DB_PASSWORD|postgres:\/\//i);
      expect(Object.keys(result).sort()).toEqual(['commit', 'database', 'environment', 'status', 'version']);
    });
  });
});
