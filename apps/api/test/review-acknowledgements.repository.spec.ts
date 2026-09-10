import { describe, expect, it, vi } from 'vitest';
import { ReviewAcknowledgementsRepository } from '../src/automations/review/review-acknowledgements.repository';

// acknowledge() writes through a dedicated PoolClient transaction, then reads the settled row
// back via database.query() on a fresh connection (Phase 10I design: the read-back must see
// whichever concurrent request actually won the ON CONFLICT race). Both paths share one mock so
// a single ordered sequence of mockResolvedValueOnce(...) covers the whole call chain.
function repositoryWithClient(query: ReturnType<typeof vi.fn>) {
  const client = { query, release: vi.fn() };
  return { repository: new ReviewAcknowledgementsRepository({ connect: vi.fn().mockResolvedValue(client), query } as never), client };
}

describe('ReviewAcknowledgementsRepository', () => {
  describe('findLatest', () => {
    it('looks up an acknowledgement by the exact (automation_code, source_type, source_reference) tuple', async () => {
      const row = { acknowledgement_id: '1', automation_code: 'REMISIONES_AUDI', source_type: 'AUDI_EXECUTION', source_reference: '77', source_occurred_at: '2026-08-27T22:40:01.933Z', reviewed_at: '2026-08-28T00:00:00.000Z', reviewed_by_user_id: '5', reviewed_by_email: 'user@daubert.mx' };
      const query = vi.fn().mockResolvedValue([row]);
      const repository = new ReviewAcknowledgementsRepository({ query } as never);
      await expect(repository.findLatest('REMISIONES_AUDI', 'AUDI_EXECUTION', '77')).resolves.toEqual(row);
      const [sql, values] = query.mock.calls[0]!;
      expect(sql).toContain('FROM ops.automation_review_acknowledgements');
      expect(sql).toContain('WHERE automation_code = $1 AND source_type = $2 AND source_reference = $3');
      expect(values).toEqual(['REMISIONES_AUDI', 'AUDI_EXECUTION', '77']);
    });

    it('returns null when no acknowledgement exists', async () => {
      const query = vi.fn().mockResolvedValue([]);
      const repository = new ReviewAcknowledgementsRepository({ query } as never);
      await expect(repository.findLatest('REMISIONES_AUDI', 'AUDI_EXECUTION', '77')).resolves.toBeNull();
    });
  });

  describe('acknowledge', () => {
    it('inserts idempotently with ON CONFLICT DO NOTHING under the uniqueness constraint, then reads back the row', async () => {
      const insertedRow = { acknowledgement_id: '9', automation_code: 'REMISIONES_AUDI', source_type: 'AUDI_EXECUTION', source_reference: '77', source_occurred_at: '2026-08-27T22:40:01.933Z', reviewed_at: '2026-08-28T00:00:00.000Z', reviewed_by_user_id: '5', reviewed_by_email: 'user@daubert.mx' };
      const query = vi.fn()
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce(undefined) // set app.origin
        .mockResolvedValueOnce(undefined) // set app.request_id
        .mockResolvedValueOnce(undefined) // set app.user_id
        .mockResolvedValueOnce(undefined) // set app.user_email
        .mockResolvedValueOnce(undefined) // INSERT ... ON CONFLICT
        .mockResolvedValueOnce(undefined) // COMMIT
        .mockResolvedValueOnce([insertedRow]); // findLatest read-back
      const { repository, client } = repositoryWithClient(query);

      const result = await repository.acknowledge('REMISIONES_AUDI', 'AUDI_EXECUTION', '77', '2026-08-27T22:40:01.933Z', 'req-1', { userId: '5', userEmail: 'user@daubert.mx' });

      expect(result).toEqual(insertedRow);
      const insertCall = query.mock.calls[5]!;
      expect(insertCall[0]).toContain('ON CONFLICT ON CONSTRAINT uq_automation_review_acknowledgements_source DO NOTHING');
      expect(insertCall[1]).toEqual(['REMISIONES_AUDI', 'AUDI_EXECUTION', '77', '2026-08-27T22:40:01.933Z', '5', 'user@daubert.mx']);
      expect(query).toHaveBeenCalledWith('COMMIT');
      expect(client.release).toHaveBeenCalledOnce();
    });

    it('rolls back and rethrows on a database error', async () => {
      const failure = new Error('db failure');
      const query = vi.fn()
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce(undefined);
      const { repository, client } = repositoryWithClient(query);

      await expect(repository.acknowledge('REMISIONES_AUDI', 'AUDI_EXECUTION', '77', '2026-08-27T22:40:01.933Z', 'req-1', { userId: '5', userEmail: 'user@daubert.mx' })).rejects.toBe(failure);
      expect(query).toHaveBeenLastCalledWith('ROLLBACK');
      expect(client.release).toHaveBeenCalledOnce();
    });
  });
});
