import { describe, expect, it, vi } from 'vitest';
import { AutomationTriggerRequestsRepository } from '../src/automations/trigger-requests/automation-trigger-requests.repository';

function repositoryWithClient(query: ReturnType<typeof vi.fn>) {
  const client = { query, release: vi.fn() };
  return { repository: new AutomationTriggerRequestsRepository({ connect: vi.fn().mockResolvedValue(client) } as never), client };
}

describe('AutomationTriggerRequestsRepository', () => {
  it('inserts one insert-only audit row inside a transaction with the audit-context GUCs set first', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const { repository, client } = repositoryWithClient(query);

    await repository.record('PAYMENT_NOTIFICATIONS', 'REPROCESS', 'TRIGGERED', 'req-1', { userId: '5', userEmail: 'user@daubert.mx' }, '77');

    expect(query.mock.calls[0]).toEqual(['BEGIN']);
    expect(query.mock.calls[1]).toEqual(["SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']]);
    expect(query.mock.calls[2]).toEqual(["SELECT set_config('app.request_id', $1, true)", ['req-1']]);
    const insertCall = query.mock.calls[5]!;
    expect(insertCall[0]).toContain('INSERT INTO ops.automation_trigger_requests');
    expect(insertCall[1]).toEqual(['PAYMENT_NOTIFICATIONS', 'REPROCESS', '5', 'user@daubert.mx', 'TRIGGERED', '77']);
    expect(query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('records a null target_reference by default (e.g. RUN actions, or REPROCESS with nothing eligible)', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const { repository } = repositoryWithClient(query);

    await repository.record('PAYMENT_NOTIFICATIONS', 'RUN', 'TRIGGERED', 'req-2', { userId: '5', userEmail: 'user@daubert.mx' });

    const insertCall = query.mock.calls[5]!;
    expect(insertCall[1]).toEqual(['PAYMENT_NOTIFICATIONS', 'RUN', '5', 'user@daubert.mx', 'TRIGGERED', null]);
  });

  it('rolls back and rethrows on a database error', async () => {
    const failure = new Error('db failure');
    const query = vi.fn()
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);
    const { repository, client } = repositoryWithClient(query);

    await expect(repository.record('PAYMENT_NOTIFICATIONS', 'RUN', 'UPSTREAM_ERROR', 'req-3', { userId: '5', userEmail: 'user@daubert.mx' })).rejects.toBe(failure);
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
