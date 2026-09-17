import { BadRequestException, NotFoundException } from '@nestjs/common';
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
  findReprocessableCorreoByExecutionId?: { status: 'FOUND'; correoId: string } | { status: 'NOT_FOUND' } | { status: 'NOT_ELIGIBLE' };
  triggerReprocessOutcome?: 'ACCEPTED' | 'NOT_CONFIGURED' | 'UPSTREAM_ERROR';
  recordImplementation?: () => Promise<void>;
} = {}) {
  const repository = {
    list: vi.fn().mockResolvedValue(options.listResult ?? { total: 0, executions: [] }),
    findExecutionById: vi.fn().mockResolvedValue(options.findExecutionById ?? null),
    findResultsByExecutionId: vi.fn().mockResolvedValue(options.findResultsByExecutionId ?? []),
    listRecent: vi.fn().mockResolvedValue(options.listRecent ?? []),
    findReprocessableCorreoByExecutionId: vi.fn().mockResolvedValue(options.findReprocessableCorreoByExecutionId ?? { status: 'NOT_FOUND' })
  };
  const reviewAcknowledgements = { findLatest: vi.fn().mockResolvedValue(options.acknowledged ? { acknowledgement_id: '1' } : null) };
  // PN1.2 final scope cleanup: the webhook client no longer exposes triggerRun (RUN removed).
  const webhookClient = {
    triggerReprocess: vi.fn().mockResolvedValue(options.triggerReprocessOutcome ?? 'ACCEPTED')
  };
  const triggerRequests = { record: options.recordImplementation ? vi.fn().mockImplementation(options.recordImplementation) : vi.fn().mockResolvedValue(undefined) };
  const service = new PaymentNotificationsService(repository as never, reviewAcknowledgements as never, webhookClient as never, triggerRequests as never);
  return { service, repository, reviewAcknowledgements, webhookClient, triggerRequests };
}

const identity = { userId: '5', userEmail: 'user@daubert.mx' };

describe('PaymentNotificationsService', () => {
  describe('list', () => {
    it('maps pagination meta and per-execution counts, deriving outcomeStatus', async () => {
      const { service, repository } = setup({ listResult: { total: 11, executions: [execution()] } });

      const result = await service.list({ page: 1, pageSize: 25 });

      expect(result.meta).toEqual({ page: 1, pageSize: 25, total: 11, totalPages: 1 });
      // Default execution() has manual_count: 1, so this row is PARTIAL AND reprocessAvailable
      // (PN1.2 correction §3: a MANUAL provider result — e.g. "IZZI" missing recipients — is
      // recoverable once master data is fixed, so it must expose Reprocesar).
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
        reviewStatus: null,
        reprocessAvailable: true
      }]);
      expect(repository.list).toHaveBeenCalledWith(1, 25);
    });

    it('reports reprocessAvailable=true for a correo-level ERROR, and independently for a PROCESADO/PARTIAL row with a MANUAL or ERROR provider result (the IZZI case)', async () => {
      const { service } = setup({
        listResult: {
          total: 3,
          executions: [
            execution({ execution_id: '50', processing_status: 'ERROR', total_results: 0, ready_count: 0, manual_count: 0 }),
            execution({ execution_id: '51', processing_status: 'PROCESADO', manual_count: 1, ready_count: 4, error_count: 0 }),
            execution({ execution_id: '52', processing_status: 'PROCESADO', manual_count: 0, ready_count: 5, error_count: 0, total_results: 5 })
          ]
        }
      });
      const result = await service.list({ page: 1, pageSize: 25 });
      expect(result.data.find((row) => row.executionId === '50')?.reprocessAvailable).toBe(true);
      // PARTIAL (PROCESADO + a MANUAL result, e.g. "IZZI" missing recipients) MUST imply
      // reprocessAvailable — this is the corrected PN1.2 predicate, derived from persisted
      // provider-result counts, not from the outcomeStatus label itself.
      expect(result.data.find((row) => row.executionId === '51')?.outcomeStatus).toBe('PARTIAL');
      expect(result.data.find((row) => row.executionId === '51')?.reprocessAvailable).toBe(true);
      // A genuinely healthy COMPLETED execution (all LISTO) must stay reprocessAvailable=false.
      expect(result.data.find((row) => row.executionId === '52')?.outcomeStatus).toBe('COMPLETED');
      expect(result.data.find((row) => row.executionId === '52')?.reprocessAvailable).toBe(false);
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
        'processedAt', 'processingStatus', 'readyCount', 'reprocessAvailable', 'reviewStatus', 'summarySent', 'summarySentAt', 'totalResults'
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

  // PN1.2 final scope cleanup: "Ejecutar ahora" (RUN) was removed from Payment Notifications —
  // the production n8n workflow already polls independently, so a manual trigger for it added no
  // value. Reprocesar (below) is unaffected.
  it('no longer exposes a run() method', () => {
    const { service } = setup();
    expect((service as unknown as Record<string, unknown>).run).toBeUndefined();
  });

  describe('reprocess (PN1.2 targeting fix §4/§5/§6)', () => {
    it('resolves the requested executionId, forwards its correo_id to the webhook, and records TRIGGERED with the internal target_reference', async () => {
      const { service, repository, webhookClient, triggerRequests } = setup({ findReprocessableCorreoByExecutionId: { status: 'FOUND', correoId: '77' }, triggerReprocessOutcome: 'ACCEPTED' });
      const result = await service.reprocess('77', 'req-1', identity);
      expect(result).toEqual({ status: 'TRIGGERED' });
      expect(repository.findReprocessableCorreoByExecutionId).toHaveBeenCalledWith('77');
      expect(webhookClient.triggerReprocess).toHaveBeenCalledWith('77');
      expect(triggerRequests.record).toHaveBeenCalledWith('PAYMENT_NOTIFICATIONS', 'REPROCESS', 'TRIGGERED', 'req-1', identity, '77');
    });

    // Regression for the confirmed targeting bug: two independently eligible executions (A older,
    // B newer, both MANUAL/reprocessAvailable=true). Clicking Reprocesar on A must resolve and
    // forward exactly A's correo_id — B must never be selected, regardless of recency.
    it('clicking Reprocesar on the older of two eligible executions (A) resolves and forwards A, never the newer one (B)', async () => {
      const lookup = vi.fn().mockImplementation((executionId: string) => {
        if (executionId === 'exec-A') return Promise.resolve({ status: 'FOUND', correoId: 'correo-A' });
        if (executionId === 'exec-B') return Promise.resolve({ status: 'FOUND', correoId: 'correo-B' });
        return Promise.resolve({ status: 'NOT_FOUND' });
      });
      const webhookClient = { triggerReprocess: vi.fn().mockResolvedValue('ACCEPTED') };
      const triggerRequests = { record: vi.fn().mockResolvedValue(undefined) };
      const repository = { list: vi.fn(), findExecutionById: vi.fn(), findResultsByExecutionId: vi.fn(), listRecent: vi.fn(), findReprocessableCorreoByExecutionId: lookup };
      const reviewAcknowledgements = { findLatest: vi.fn() };
      const service = new PaymentNotificationsService(repository as never, reviewAcknowledgements as never, webhookClient as never, triggerRequests as never);

      const result = await service.reprocess('exec-A', 'req-A', identity);

      expect(result).toEqual({ status: 'TRIGGERED' });
      expect(lookup).toHaveBeenCalledWith('exec-A');
      expect(lookup).not.toHaveBeenCalledWith('exec-B');
      expect(webhookClient.triggerReprocess).toHaveBeenCalledWith('correo-A');
      expect(webhookClient.triggerReprocess).not.toHaveBeenCalledWith('correo-B');
      expect(triggerRequests.record).toHaveBeenCalledWith('PAYMENT_NOTIFICATIONS', 'REPROCESS', 'TRIGGERED', 'req-A', identity, 'correo-A');
    });

    it('clicking Reprocesar on the newer of two eligible executions (B) resolves and forwards B, never A', async () => {
      const lookup = vi.fn().mockImplementation((executionId: string) => {
        if (executionId === 'exec-A') return Promise.resolve({ status: 'FOUND', correoId: 'correo-A' });
        if (executionId === 'exec-B') return Promise.resolve({ status: 'FOUND', correoId: 'correo-B' });
        return Promise.resolve({ status: 'NOT_FOUND' });
      });
      const webhookClient = { triggerReprocess: vi.fn().mockResolvedValue('ACCEPTED') };
      const triggerRequests = { record: vi.fn().mockResolvedValue(undefined) };
      const repository = { list: vi.fn(), findExecutionById: vi.fn(), findResultsByExecutionId: vi.fn(), listRecent: vi.fn(), findReprocessableCorreoByExecutionId: lookup };
      const reviewAcknowledgements = { findLatest: vi.fn() };
      const service = new PaymentNotificationsService(repository as never, reviewAcknowledgements as never, webhookClient as never, triggerRequests as never);

      const result = await service.reprocess('exec-B', 'req-B', identity);

      expect(result).toEqual({ status: 'TRIGGERED' });
      expect(lookup).toHaveBeenCalledWith('exec-B');
      expect(lookup).not.toHaveBeenCalledWith('exec-A');
      expect(webhookClient.triggerReprocess).toHaveBeenCalledWith('correo-B');
      expect(webhookClient.triggerReprocess).not.toHaveBeenCalledWith('correo-A');
    });

    it('returns NOT_FOUND and never calls the webhook when the requested executionId does not exist', async () => {
      const { service, webhookClient, triggerRequests } = setup({ findReprocessableCorreoByExecutionId: { status: 'NOT_FOUND' } });
      const result = await service.reprocess('999999', 'req-2', identity);
      expect(result).toEqual({ status: 'NOT_FOUND' });
      expect(webhookClient.triggerReprocess).not.toHaveBeenCalled();
      expect(triggerRequests.record).toHaveBeenCalledWith('PAYMENT_NOTIFICATIONS', 'REPROCESS', 'NOTHING_TO_REPROCESS', 'req-2', identity, null);
    });

    it('returns NOT_ELIGIBLE and never calls the webhook when the requested execution is no longer reprocessable', async () => {
      const { service, webhookClient, triggerRequests } = setup({ findReprocessableCorreoByExecutionId: { status: 'NOT_ELIGIBLE' } });
      const result = await service.reprocess('52', 'req-2b', identity);
      expect(result).toEqual({ status: 'NOT_ELIGIBLE' });
      expect(webhookClient.triggerReprocess).not.toHaveBeenCalled();
      expect(triggerRequests.record).toHaveBeenCalledWith('PAYMENT_NOTIFICATIONS', 'REPROCESS', 'NOTHING_TO_REPROCESS', 'req-2b', identity, null);
    });

    it.each(['NOT_CONFIGURED', 'UPSTREAM_ERROR'] as const)('records UPSTREAM_ERROR with target_reference when the webhook outcome is %s', async (outcome) => {
      const { service, triggerRequests } = setup({ findReprocessableCorreoByExecutionId: { status: 'FOUND', correoId: '77' }, triggerReprocessOutcome: outcome });
      const result = await service.reprocess('77', 'req-3', identity);
      expect(result).toEqual({ status: 'UPSTREAM_ERROR' });
      expect(triggerRequests.record).toHaveBeenCalledWith('PAYMENT_NOTIFICATIONS', 'REPROCESS', 'UPSTREAM_ERROR', 'req-3', identity, '77');
    });

    it('throws BadRequestException when the request has no authenticated user email', async () => {
      const { service } = setup();
      await expect(service.reprocess('32', 'req-4', { userId: null, userEmail: null })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('never exposes the resolved correo_id in the returned result', async () => {
      const { service } = setup({ findReprocessableCorreoByExecutionId: { status: 'FOUND', correoId: '999999999999999' } });
      const result = await service.reprocess('32', 'req-5', identity);
      expect(JSON.stringify(result)).not.toMatch(/999999999999999/);
    });

    it('still returns TRIGGERED (PN1.2 correction §11) when the webhook succeeds but the audit-row insert fails', async () => {
      const { service, webhookClient } = setup({
        findReprocessableCorreoByExecutionId: { status: 'FOUND', correoId: '77' },
        triggerReprocessOutcome: 'ACCEPTED',
        recordImplementation: () => { throw new Error('db unavailable'); }
      });
      const result = await service.reprocess('77', 'req-6', identity);
      expect(result).toEqual({ status: 'TRIGGERED' });
      expect(webhookClient.triggerReprocess).toHaveBeenCalledWith('77');
    });

    it('still returns UPSTREAM_ERROR (not masked) when both the webhook call and the subsequent audit-row insert fail', async () => {
      const { service } = setup({
        findReprocessableCorreoByExecutionId: { status: 'FOUND', correoId: '77' },
        triggerReprocessOutcome: 'UPSTREAM_ERROR',
        recordImplementation: () => { throw new Error('db unavailable'); }
      });
      const result = await service.reprocess('77', 'req-7', identity);
      expect(result).toEqual({ status: 'UPSTREAM_ERROR' });
    });
  });
});
