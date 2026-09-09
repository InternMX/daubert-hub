import { describe, expect, it, vi } from 'vitest';
import { AutomationsOverviewController } from '../src/automations/overview/automations-overview.controller';

describe('AutomationsOverviewController', () => {
  it('delegates to the service with no parameters', async () => {
    const get = vi.fn().mockResolvedValue({ data: [] });
    const controller = new AutomationsOverviewController({ getOverview: get } as never);
    await expect(controller.get()).resolves.toEqual({ data: [] });
    expect(get).toHaveBeenCalledWith();
  });
});
