import { describe, expect, it, vi } from 'vitest';
import { AutomationsOverviewService } from '../src/automations/overview/automations-overview.service';

function health(environment: 'TEST' | 'PRODUCTION' | 'UNKNOWN' = 'TEST') {
  return { status: 'ok' as const, database: 'connected' as const, environment, version: '0.8.0-pilot.1', commit: 'abc123' };
}

function paymentSummary(overrides: Partial<{
  createdAt: string; processedAt: string | null; processingStatus: 'PENDIENTE' | 'PROCESADO' | 'ERROR';
  outcomeStatus: 'COMPLETED' | 'PARTIAL' | 'FAILED' | null;
}> = {}) {
  return {
    executionId: '32',
    createdAt: '2026-09-08T18:35:00.000Z',
    processedAt: '2026-09-08T18:35:00.000Z',
    processingStatus: 'PROCESADO' as const,
    outcomeStatus: 'PARTIAL' as const,
    totalResults: 5, readyCount: 4, manualCount: 1, errorCount: 0, omittedCount: 0,
    summarySent: false, summarySentAt: null,
    ...overrides
  };
}

const NO_REVIEW = { required: false, problemOccurredAt: null, problemOutcome: null };

function setup(options: { audiRow?: unknown; paymentData?: unknown[]; environment?: 'TEST' | 'PRODUCTION' | 'UNKNOWN'; audiReview?: unknown; paymentReview?: unknown } = {}) {
  const repository = { findAudiOverview: vi.fn().mockResolvedValue(options.audiRow ?? null) };
  const paymentNotifications = { list: vi.fn().mockResolvedValue({ data: options.paymentData ?? [], meta: { page: 1, pageSize: 1, total: options.paymentData?.length ?? 0, totalPages: 1 } }) };
  const healthService = { getHealth: vi.fn().mockResolvedValue(health(options.environment)) };
  const review = { getReviewState: vi.fn().mockImplementation((code: string) => Promise.resolve(code === 'REMISIONES_AUDI' ? (options.audiReview ?? NO_REVIEW) : (options.paymentReview ?? NO_REVIEW))) };
  const service = new AutomationsOverviewService(repository as never, paymentNotifications as never, healthService as never, review as never);
  return { service, repository, paymentNotifications, healthService, review };
}

describe('AutomationsOverviewService', () => {
  it('returns exactly three automations with their confirmed static polling intervals', async () => {
    const { service } = setup();
    const { data } = await service.getOverview();
    expect(data.map((item) => [item.code, item.polling.intervalMinutes, item.polling.label])).toEqual([
      ['REMISIONES_AUDI', 10, 'Cada 10 minutos'],
      ['PAYMENT_NOTIFICATIONS', 5, 'Cada 5 minutos'],
      ['REMISIONES_CATERPILLAR', 15, 'Cada 15 minutos']
    ]);
  });

  it('requests a single page-1/pageSize-1 payment notification lookup, reusing Phase 10B service logic', async () => {
    const { service, paymentNotifications } = setup();
    await service.getOverview();
    expect(paymentNotifications.list).toHaveBeenCalledWith({ page: 1, pageSize: 1 });
  });

  describe('environment', () => {
    it.each(['TEST', 'PRODUCTION', 'UNKNOWN'] as const)('propagates %s from HealthService to every automation', async (environment) => {
      const { service } = setup({ environment });
      const { data } = await service.getOverview();
      expect(data.every((item) => item.environment === environment)).toBe(true);
    });
  });

  describe('Remisiones Audi', () => {
    it.each([
      ['ACTIVA', 'ACTIVE'],
      ['INACTIVA', 'INACTIVE']
    ] as const)('maps lifecycle_status %s to %s', async (lifecycleStatus, expected) => {
      const { service } = setup({ audiRow: { lifecycle_status: lifecycleStatus, execution_state: null, occurred_at: null } });
      const { data } = await service.getOverview();
      expect(data[0]).toMatchObject({ code: 'REMISIONES_AUDI', lifecycleStatus: expected });
    });

    it('reports lifecycleStatus=null when the automation is not registered at all', async () => {
      const { service } = setup({ audiRow: null });
      const { data } = await service.getOverview();
      expect(data[0]).toMatchObject({ lifecycleStatus: null, lastProcessing: null });
    });

    it.each([
      ['COMPLETADA', 'COMPLETED'],
      ['ERROR', 'FAILED'],
      ['PROCESANDO', 'PROCESSING'],
      ['CANCELADA', 'CANCELLED']
    ] as const)('maps execution_state %s to outcome %s', async (executionState, expected) => {
      const { service } = setup({ audiRow: { lifecycle_status: 'ACTIVA', execution_state: executionState, occurred_at: '2026-08-27T22:40:01.933Z' } });
      const { data } = await service.getOverview();
      expect(data[0]?.lastProcessing).toEqual({ occurredAt: '2026-08-27T22:40:01.933Z', outcome: expected });
    });

    it('reports lastProcessing=null when the automation has never processed anything', async () => {
      const { service } = setup({ audiRow: { lifecycle_status: 'ACTIVA', execution_state: null, occurred_at: null } });
      const { data } = await service.getOverview();
      expect(data[0]?.lastProcessing).toBeNull();
    });

    it('never reports a lastCheckAt or nextCheckAt value (no-work polling cycles are not persisted)', async () => {
      const { service } = setup({ audiRow: { lifecycle_status: 'ACTIVA', execution_state: 'COMPLETADA', occurred_at: '2026-08-27T22:40:01.933Z' } });
      const { data } = await service.getOverview();
      expect(data[0]?.lastCheckAt).toBeNull();
      expect(data[0]?.nextCheckAt).toBeNull();
    });

    it('reports integration status and capabilities from the static catalog', async () => {
      const { service } = setup();
      const { data } = await service.getOverview();
      expect(data[0]).toMatchObject({ integrationStatus: 'INTEGRATED', capabilities: { hasDashboard: true, hasHistory: true, hasDetail: false } });
    });
  });

  describe('Payment Notifications', () => {
    it.each(['COMPLETED', 'PARTIAL', 'FAILED', null] as const)('preserves outcomeStatus %s exactly from the Phase 10B service', async (outcomeStatus) => {
      const { service } = setup({ paymentData: [paymentSummary({ outcomeStatus })] });
      const { data } = await service.getOverview();
      expect(data[1]?.lastProcessing?.outcome).toBe(outcomeStatus);
    });

    it('reports lastProcessing=null when there is no execution yet', async () => {
      const { service } = setup({ paymentData: [] });
      const { data } = await service.getOverview();
      expect(data[1]?.lastProcessing).toBeNull();
    });

    it('uses processedAt, falling back to createdAt', async () => {
      const { service } = setup({ paymentData: [paymentSummary({ processedAt: null, createdAt: '2026-01-01T00:00:00.000Z' })] });
      const { data } = await service.getOverview();
      expect(data[1]?.lastProcessing?.occurredAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('never reports a lifecycleStatus, lastCheckAt, or nextCheckAt (no automation-level flag or check persistence exists)', async () => {
      const { service } = setup({ paymentData: [paymentSummary()] });
      const { data } = await service.getOverview();
      expect(data[1]?.lifecycleStatus).toBeNull();
      expect(data[1]?.lastCheckAt).toBeNull();
      expect(data[1]?.nextCheckAt).toBeNull();
    });
  });

  describe('Remisiones Caterpillar', () => {
    it('reports NOT_INTEGRATED with no fabricated runtime state', async () => {
      const { service } = setup();
      const { data } = await service.getOverview();
      expect(data[2]).toMatchObject({
        code: 'REMISIONES_CATERPILLAR',
        name: 'Remisiones Caterpillar',
        integrationStatus: 'NOT_INTEGRATED',
        lifecycleStatus: null,
        lastCheckAt: null,
        lastProcessing: null,
        nextCheckAt: null,
        capabilities: { hasDashboard: false, hasHistory: false, hasDetail: false }
      });
    });

    it('still reports the confirmed polling frequency despite having no integration', async () => {
      const { service } = setup();
      const { data } = await service.getOverview();
      expect(data[2]?.polling).toEqual({ intervalMinutes: 15, label: 'Cada 15 minutos' });
    });

    it('is never queried against the database (no repository call made for it)', async () => {
      const { service, repository, paymentNotifications } = setup();
      await service.getOverview();
      expect(repository.findAudiOverview).toHaveBeenCalledTimes(1);
      expect(paymentNotifications.list).toHaveBeenCalledTimes(1);
    });
  });

  describe('sensitive fields', () => {
    it('never exposes technical/internal identifiers or diagnostics anywhere in the response', async () => {
      const { service } = setup({
        audiRow: { lifecycle_status: 'ACTIVA', execution_state: 'ERROR', occurred_at: '2026-08-27T22:40:01.933Z' },
        paymentData: [paymentSummary()],
        audiReview: { required: true, problemOccurredAt: '2026-08-27T22:40:01.933Z', problemOutcome: 'FAILED' }
      });
      const result = await service.getOverview();
      const text = JSON.stringify(result);
      expect(text).not.toMatch(/n8n_execution_id|run_name|error_nodo|error_mensaje|correo_id|ejecucion_id|automatizacion_id|outlook|remitente|detalle_error|acknowledgement_id|source_reference/i);
      for (const item of result.data) {
        expect(Object.keys(item).sort()).toEqual(['capabilities', 'code', 'description', 'environment', 'integrationStatus', 'lastCheckAt', 'lastProcessing', 'lifecycleStatus', 'name', 'nextCheckAt', 'polling', 'review']);
        expect(Object.keys(item.review).sort()).toEqual(['problemOccurredAt', 'problemOutcome', 'required']);
      }
    });

    it('propagates a repository failure instead of fabricating a healthy card (consistent-failure convention)', async () => {
      const repository = { findAudiOverview: vi.fn().mockRejectedValue(new Error('db down')) };
      const paymentNotifications = { list: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 1, total: 0, totalPages: 0 } }) };
      const healthService = { getHealth: vi.fn().mockResolvedValue(health()) };
      const review = { getReviewState: vi.fn().mockResolvedValue(NO_REVIEW) };
      const service = new AutomationsOverviewService(repository as never, paymentNotifications as never, healthService as never, review as never);
      await expect(service.getOverview()).rejects.toThrow('db down');
    });
  });

  describe('review (Phase 10I)', () => {
    it('reports required=true with the problem outcome/occurredAt when the latest problem is unacknowledged', async () => {
      const { service } = setup({ audiReview: { required: true, problemOccurredAt: '2026-08-27T22:40:01.933Z', problemOutcome: 'FAILED' } });
      const { data } = await service.getOverview();
      expect(data[0]?.review).toEqual({ required: true, problemOccurredAt: '2026-08-27T22:40:01.933Z', problemOutcome: 'FAILED' });
    });

    it('reports required=false once the latest problem has been acknowledged, while keeping the historical outcome', async () => {
      const { service } = setup({ paymentReview: { required: false, problemOccurredAt: '2026-08-27T22:40:01.933Z', problemOutcome: 'PARTIAL' } });
      const { data } = await service.getOverview();
      expect(data[1]?.review).toEqual({ required: false, problemOccurredAt: '2026-08-27T22:40:01.933Z', problemOutcome: 'PARTIAL' });
    });

    it('reports required=false with null occurredAt/outcome when there is no historical problem', async () => {
      const { service } = setup();
      const { data } = await service.getOverview();
      expect(data[0]?.review).toEqual(NO_REVIEW);
      expect(data[1]?.review).toEqual(NO_REVIEW);
    });

    it('always reports Caterpillar review as required=false with no fabricated problem, without querying it', async () => {
      const { service, review } = setup();
      const { data } = await service.getOverview();
      expect(data[2]?.review).toEqual(NO_REVIEW);
      expect(review.getReviewState).toHaveBeenCalledTimes(2);
      expect(review.getReviewState).toHaveBeenCalledWith('REMISIONES_AUDI');
      expect(review.getReviewState).toHaveBeenCalledWith('PAYMENT_NOTIFICATIONS');
      expect(review.getReviewState).not.toHaveBeenCalledWith('REMISIONES_CATERPILLAR');
    });
  });
});
