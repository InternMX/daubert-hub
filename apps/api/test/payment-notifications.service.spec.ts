import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PaymentNotificationsService } from '../src/automations/payment-notifications/payment-notifications.service';

function execution(overrides: Partial<{
  execution_id: string; created_at: string; processed_at: string | null; processing_status: 'PENDIENTE' | 'PROCESADO' | 'ERROR';
  summary_sent: boolean; summary_sent_at: string | null; total_results: number; ready_count: number; manual_count: number; error_count: number; omitted_count: number;
}> = {}) {
  return {
    execution_id: '32',
    created_at: '2026-08-19T19:31:49.884Z',
    processed_at: '2026-08-19T19:31:49.919Z',
    processing_status: 'PROCESADO' as const,
    summary_sent: false,
    summary_sent_at: null,
    total_results: 5,
    ready_count: 4,
    manual_count: 1,
    error_count: 0,
    omitted_count: 0,
    ...overrides
  };
}

// listRecent defaults to [] (no review-worthy execution) so `list()`'s internal
// findLatestReviewWorthyExecution() call never breaks a test that isn't exercising reviewStatus.
function setup(options: {
  listResult?: { total: number; executions: ReturnType<typeof execution>[] };
  findExecutionById?: ReturnType<typeof execution> | null;
  findResultsByExecutionId?: unknown[];
  listRecent?: ReturnType<typeof execution>[];
  acknowledged?: boolean;
} = {}) {
  const repository = {
    list: vi.fn().mockResolvedValue(options.listResult ?? { total: 0, executions: [] }),
    findExecutionById: vi.fn().mockResolvedValue(options.findExecutionById ?? null),
    findResultsByExecutionId: vi.fn().mockResolvedValue(options.findResultsByExecutionId ?? []),
    listRecent: vi.fn().mockResolvedValue(options.listRecent ?? [])
  };
  const reviewAcknowledgements = { findLatest: vi.fn().mockResolvedValue(options.acknowledged ? { acknowledgement_id: '1' } : null) };
  return { service: new PaymentNotificationsService(repository as never, reviewAcknowledgements as never), repository, reviewAcknowledgements };
}

describe('PaymentNotificationsService', () => {
  describe('list', () => {
    it('maps pagination meta and per-execution counts, deriving outcomeStatus', async () => {
      const { service, repository } = setup({ listResult: { total: 11, executions: [execution()] } });

      const result = await service.list({ page: 1, pageSize: 25 });

      expect(result.meta).toEqual({ page: 1, pageSize: 25, total: 11, totalPages: 1 });
      expect(result.data).toEqual([{
        executionId: '32',
        createdAt: '2026-08-19T19:31:49.884Z',
        processedAt: '2026-08-19T19:31:49.919Z',
        processingStatus: 'PROCESADO',
        outcomeStatus: 'PARTIAL',
        totalResults: 5,
        readyCount: 4,
        manualCount: 1,
        errorCount: 0,
        omittedCount: 0,
        summarySent: false,
        summarySentAt: null,
        reviewStatus: null
      }]);
      expect(repository.list).toHaveBeenCalledWith(1, 25);
    });

    it('derives COMPLETED when PROCESADO has only LISTO/OMITIDO results', async () => {
      const { service } = setup({ listResult: { total: 1, executions: [execution({ manual_count: 0, ready_count: 5, total_results: 5 })] } });
      const result = await service.list({ page: 1, pageSize: 25 });
      expect(result.data[0]?.outcomeStatus).toBe('COMPLETED');
    });

    it('derives FAILED for a top-level ERROR with no useful results', async () => {
      const { service } = setup({ listResult: { total: 1, executions: [execution({ processing_status: 'ERROR', total_results: 0, ready_count: 0, manual_count: 0 })] } });
      const result = await service.list({ page: 1, pageSize: 25 });
      expect(result.data[0]?.outcomeStatus).toBe('FAILED');
    });

    it('derives outcomeStatus=null for a PROCESADO execution with zero provider results, never COMPLETED', async () => {
      const { service } = setup({ listResult: { total: 1, executions: [execution({ total_results: 0, ready_count: 0, manual_count: 0, error_count: 0, omitted_count: 0 })] } });
      const result = await service.list({ page: 1, pageSize: 25 });
      expect(result.data[0]?.outcomeStatus).toBeNull();
      expect(result.data[0]?.processingStatus).toBe('PROCESADO');
    });

    it('derives outcomeStatus=null for a PENDIENTE execution', async () => {
      const { service } = setup({ listResult: { total: 1, executions: [execution({ processing_status: 'PENDIENTE', total_results: 0, ready_count: 0, manual_count: 0, processed_at: null })] } });
      const result = await service.list({ page: 1, pageSize: 25 });
      expect(result.data[0]?.outcomeStatus).toBeNull();
      expect(result.data[0]?.processingStatus).toBe('PENDIENTE');
      expect(result.data[0]?.processedAt).toBeNull();
    });

    it('does not expose any sensitive field on a summary item', async () => {
      const { service } = setup({ listResult: { total: 1, executions: [execution()] } });
      const result = await service.list({ page: 1, pageSize: 25 });
      expect(Object.keys(result.data[0]!).sort()).toEqual([
        'createdAt', 'errorCount', 'executionId', 'manualCount', 'omittedCount', 'outcomeStatus',
        'processedAt', 'processingStatus', 'readyCount', 'reviewStatus', 'summarySent', 'summarySentAt', 'totalResults'
      ]);
      expect(JSON.stringify(result)).not.toMatch(/outlook|remitente|asunto|correos_para|correos_cc|correos_cco|rfc|detalle_error|motivo|acknowledgement_id/i);
    });

    describe('reviewStatus (Phase 10I UX refinement)', () => {
      it('marks the row matching the current unacknowledged review-worthy execution as REQUIRED', async () => {
        const { service } = setup({
          listResult: { total: 2, executions: [execution({ execution_id: '42', processing_status: 'ERROR', total_results: 0, ready_count: 0, manual_count: 0 }), execution({ execution_id: '41' })] },
          listRecent: [execution({ execution_id: '42', processing_status: 'ERROR', total_results: 0, ready_count: 0, manual_count: 0 })],
          acknowledged: false
        });
        const result = await service.list({ page: 1, pageSize: 25 });
        expect(result.data.find((row) => row.executionId === '42')?.reviewStatus).toBe('REQUIRED');
        expect(result.data.find((row) => row.executionId === '41')?.reviewStatus).toBeNull();
      });

      it('marks the row matching the current acknowledged review-worthy execution as REVIEWED', async () => {
        const { service } = setup({
          listResult: { total: 1, executions: [execution({ execution_id: '42', processing_status: 'ERROR', total_results: 0, ready_count: 0, manual_count: 0 })] },
          listRecent: [execution({ execution_id: '42', processing_status: 'ERROR', total_results: 0, ready_count: 0, manual_count: 0 })],
          acknowledged: true
        });
        const result = await service.list({ page: 1, pageSize: 25 });
        expect(result.data[0]?.reviewStatus).toBe('REVIEWED');
      });

      it('never marks an older PARTIAL/FAILED row that is not the current problem', async () => {
        // listRecent (used by findLatestReviewWorthyExecution) resolves only the newest
        // review-worthy execution (42); an older ERROR row (40) present in the visible page must
        // stay null.
        const { service } = setup({
          listResult: {
            total: 2,
            executions: [
              execution({ execution_id: '42', processing_status: 'PROCESADO', manual_count: 0, error_count: 0 }),
              execution({ execution_id: '40', processing_status: 'ERROR', total_results: 0, ready_count: 0, manual_count: 0 })
            ]
          },
          listRecent: []
        });
        const result = await service.list({ page: 1, pageSize: 25 });
        expect(result.data[0]?.reviewStatus).toBeNull();
        expect(result.data[1]?.reviewStatus).toBeNull();
      });

      it('is null on every row when there is no review-worthy execution at all', async () => {
        const { service } = setup({ listResult: { total: 1, executions: [execution()] } });
        const result = await service.list({ page: 1, pageSize: 25 });
        expect(result.data[0]?.reviewStatus).toBeNull();
      });

      it('looks up the acknowledgement using the PAYMENT_NOTIFICATION_EXECUTION source type and the resolved executionId', async () => {
        const { service, reviewAcknowledgements } = setup({
          listResult: { total: 1, executions: [execution({ execution_id: '42', processing_status: 'ERROR', total_results: 0, ready_count: 0, manual_count: 0 })] },
          listRecent: [execution({ execution_id: '42', processing_status: 'ERROR', total_results: 0, ready_count: 0, manual_count: 0 })]
        });
        await service.list({ page: 1, pageSize: 25 });
        expect(reviewAcknowledgements.findLatest).toHaveBeenCalledWith('PAYMENT_NOTIFICATIONS', 'PAYMENT_NOTIFICATION_EXECUTION', '42');
      });

      it('does not look up an acknowledgement at all when there is no review-worthy execution', async () => {
        const { service, reviewAcknowledgements } = setup({ listResult: { total: 1, executions: [execution()] } });
        await service.list({ page: 1, pageSize: 25 });
        expect(reviewAcknowledgements.findLatest).not.toHaveBeenCalled();
      });
    });
  });

  describe('getDetail', () => {
    it('returns the execution summary with grouped, BIGINT-safe provider results', async () => {
      const { service, repository } = setup({
        findExecutionById: execution(),
        findResultsByExecutionId: [
          { company_id: '9007199254740993', company_name: 'Acme', status: 'LISTO', motivo: null },
          { company_id: '103', company_name: 'Otra', status: 'MANUAL', motivo: 'DESTINATARIOS_PARA' }
        ]
      });

      const result = await service.getDetail('32');

      expect(result.data.executionId).toBe('32');
      expect(result.data.results).toEqual([
        { companyId: '9007199254740993', companyName: 'Acme', status: 'LISTO', attentionReason: null },
        { companyId: '103', companyName: 'Otra', status: 'MANUAL', attentionReason: 'Faltan destinatarios principales configurados.' }
      ]);
      expect(typeof result.data.results[0]!.companyId).toBe('string');
      expect(repository.findExecutionById).toHaveBeenCalledWith('32');
      expect(repository.findResultsByExecutionId).toHaveBeenCalledWith('32');
    });

    it('keeps a provider result visible with companyName=null when enrichment cannot resolve it', async () => {
      const { service } = setup({
        findExecutionById: execution(),
        findResultsByExecutionId: [{ company_id: '999', company_name: null, status: 'ERROR', motivo: null }]
      });

      const result = await service.getDetail('32');

      expect(result.data.results).toEqual([{ companyId: '999', companyName: null, status: 'ERROR', attentionReason: null }]);
    });

    it('never exposes an unknown motivo value raw', async () => {
      const { service } = setup({
        findExecutionById: execution(),
        findResultsByExecutionId: [{ company_id: '1', company_name: 'Acme', status: 'MANUAL', motivo: 'SOME_UNDOCUMENTED_CODE' }]
      });

      const result = await service.getDetail('32');

      expect(result.data.results[0]?.attentionReason).toBe('Requiere revisión.');
      expect(JSON.stringify(result)).not.toMatch(/SOME_UNDOCUMENTED_CODE/);
    });

    it('throws NotFoundException for an unknown executionId', async () => {
      const { service, repository } = setup({ findExecutionById: null });

      await expect(service.getDetail('999999')).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.findResultsByExecutionId).not.toHaveBeenCalled();
    });
  });

  describe('findLatestReviewWorthyExecution (Phase 10I)', () => {
    it('returns the newest PARTIAL/FAILED execution, reusing derivePaymentNotificationOutcome via mapSummary', async () => {
      const { service, repository } = setup({ listRecent: [execution({ execution_id: '40', processing_status: 'PROCESADO', manual_count: 1 })] });
      const result = await service.findLatestReviewWorthyExecution();
      expect(result?.executionId).toBe('40');
      expect(result?.outcomeStatus).toBe('PARTIAL');
      expect(repository.listRecent).toHaveBeenCalledWith(500);
    });

    it('skips newer COMPLETED/null-outcome executions to find an older PARTIAL/FAILED one', async () => {
      const { service } = setup({
        listRecent: [
          execution({ execution_id: '42', processing_status: 'PROCESADO', manual_count: 0, error_count: 0 }),
          execution({ execution_id: '41', processing_status: 'PENDIENTE', total_results: 0, ready_count: 0, manual_count: 0 }),
          execution({ execution_id: '40', processing_status: 'ERROR', total_results: 0, ready_count: 0, manual_count: 0 })
        ]
      });
      const result = await service.findLatestReviewWorthyExecution();
      expect(result?.executionId).toBe('40');
      expect(result?.outcomeStatus).toBe('FAILED');
    });

    it('returns null when no execution is review-worthy', async () => {
      const { service } = setup({ listRecent: [execution({ manual_count: 0, error_count: 0 })] });
      await expect(service.findLatestReviewWorthyExecution()).resolves.toBeNull();
    });

    it('returns null when there are no executions at all', async () => {
      const { service } = setup({ listRecent: [] });
      await expect(service.findLatestReviewWorthyExecution()).resolves.toBeNull();
    });
  });
});
