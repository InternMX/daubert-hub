import { describe, expect, it } from 'vitest';
import { HealthService } from '../src/health/health.service';

describe('HealthService', () => {
  it('only reports a connected database after the adapter confirms it', async () => {
    const connected = new HealthService({ checkConnection: () => Promise.resolve(true) } as never);
    const unavailable = new HealthService({ checkConnection: () => Promise.resolve(false) } as never);
    await expect(connected.getHealth()).resolves.toEqual({ status: 'ok', database: 'connected' });
    await expect(unavailable.getHealth()).resolves.toEqual({ status: 'ok', database: 'unavailable' });
  });
});
