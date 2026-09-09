import { describe, expect, it, vi } from 'vitest';
import { AudiExecutionsController } from '../src/automations/remisiones-audi/audi-executions.controller';

describe('AudiExecutionsController', () => {
  it('delegates to the service with the parsed query DTO', async () => {
    const list = vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } });
    const controller = new AudiExecutionsController({ list } as never);
    await controller.list({ page: 2, pageSize: 10 });
    expect(list).toHaveBeenCalledWith({ page: 2, pageSize: 10 });
  });
});
