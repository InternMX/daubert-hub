import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ReviewAcknowledgementsService } from '../src/automations/review/review-acknowledgements.service';

function setup(options: { audiProblem?: unknown; paymentProblem?: unknown; acknowledgement?: unknown } = {}) {
  const repository = {
    findLatest: vi.fn().mockResolvedValue(options.acknowledgement ?? null),
    acknowledge: vi.fn()
  };
  const audiExecutions = { findLatestProblem: vi.fn().mockResolvedValue(options.audiProblem ?? null) };
  const paymentNotifications = { findLatestReviewWorthyExecution: vi.fn().mockResolvedValue(options.paymentProblem ?? null) };
  const service = new ReviewAcknowledgementsService(repository as never, audiExecutions as never, paymentNotifications as never);
  return { service, repository, audiExecutions, paymentNotifications };
}

const identity = { userId: '5', userEmail: 'user@daubert.mx' };

describe('ReviewAcknowledgementsService', () => {
  describe('getReviewState — Audi', () => {
    it.each(['ERROR', 'CANCELADA'] as const)('reports required=true for a latest unacknowledged %s execution', async (executionState) => {
      const { service } = setup({ audiProblem: { ejecucion_id: '77', occurred_at: '2026-08-27T22:40:01.933Z', execution_state: executionState } });
      const state = await service.getReviewState('REMISIONES_AUDI');
      expect(state.required).toBe(true);
      expect(state.problemOccurredAt).toBe('2026-08-27T22:40:01.933Z');
      expect(state.problemOutcome).toBe(executionState === 'ERROR' ? 'FAILED' : 'CANCELLED');
    });

    it('reports required=true when a COMPLETED execution is newer than an unreviewed older FAILED one (findLatestProblem already scopes to ERROR/CANCELADA)', async () => {
      // AudiExecutionsRepository.findLatestProblem only ever returns ERROR/CANCELADA rows — a
      // newer COMPLETADA row is invisible to it by construction, so the "latest problem" found
      // here is genuinely the latest FAILED one, regardless of a newer successful processing.
      const { service, audiExecutions } = setup({ audiProblem: { ejecucion_id: '50', occurred_at: '2026-08-20T00:00:00.000Z', execution_state: 'ERROR' } });
      const state = await service.getReviewState('REMISIONES_AUDI');
      expect(state).toEqual({ required: true, problemOccurredAt: '2026-08-20T00:00:00.000Z', problemOutcome: 'FAILED' });
      expect(audiExecutions.findLatestProblem).toHaveBeenCalledOnce();
    });

    it('reports required=false once that specific problem has an acknowledgement row', async () => {
      const { service } = setup({
        audiProblem: { ejecucion_id: '77', occurred_at: '2026-08-27T22:40:01.933Z', execution_state: 'ERROR' },
        acknowledgement: { acknowledgement_id: '1' }
      });
      const state = await service.getReviewState('REMISIONES_AUDI');
      expect(state.required).toBe(false);
    });

    it('reports required=false with null occurredAt/outcome when there is no historical problem', async () => {
      const { service } = setup();
      const state = await service.getReviewState('REMISIONES_AUDI');
      expect(state).toEqual({ required: false, problemOccurredAt: null, problemOutcome: null });
    });

    it('is required=true again for a new later problem (findLatest is called with the new source, finding no acknowledgement)', async () => {
      const { service, repository } = setup({ audiProblem: { ejecucion_id: '99', occurred_at: '2026-08-29T00:00:00.000Z', execution_state: 'ERROR' } });
      const state = await service.getReviewState('REMISIONES_AUDI');
      expect(state.required).toBe(true);
      expect(repository.findLatest).toHaveBeenCalledWith('REMISIONES_AUDI', 'AUDI_EXECUTION', '99');
    });
  });

  describe('getReviewState — Payment Notifications', () => {
    it.each(['PARTIAL', 'FAILED'] as const)('reports required=true for a latest unacknowledged %s execution', async (outcomeStatus) => {
      const { service } = setup({ paymentProblem: { executionId: '40', createdAt: '2026-08-27T00:00:00.000Z', processedAt: '2026-08-27T00:05:00.000Z', outcomeStatus } });
      const state = await service.getReviewState('PAYMENT_NOTIFICATIONS');
      expect(state).toEqual({ required: true, problemOccurredAt: '2026-08-27T00:05:00.000Z', problemOutcome: outcomeStatus });
    });

    it('falls back to createdAt when processedAt is null', async () => {
      const { service } = setup({ paymentProblem: { executionId: '40', createdAt: '2026-08-27T00:00:00.000Z', processedAt: null, outcomeStatus: 'FAILED' } });
      const state = await service.getReviewState('PAYMENT_NOTIFICATIONS');
      expect(state.problemOccurredAt).toBe('2026-08-27T00:00:00.000Z');
    });

    it('reports required=false once acknowledged, older problem stays reviewed even if never re-checked against a newer COMPLETED processing', async () => {
      const { service } = setup({
        paymentProblem: { executionId: '40', createdAt: '2026-08-27T00:00:00.000Z', processedAt: '2026-08-27T00:05:00.000Z', outcomeStatus: 'PARTIAL' },
        acknowledgement: { acknowledgement_id: '1' }
      });
      const state = await service.getReviewState('PAYMENT_NOTIFICATIONS');
      expect(state.required).toBe(false);
    });

    it('reports required=false with nulls when there is no review-worthy execution at all', async () => {
      const { service } = setup();
      const state = await service.getReviewState('PAYMENT_NOTIFICATIONS');
      expect(state).toEqual({ required: false, problemOccurredAt: null, problemOutcome: null });
    });
  });

  describe('getReviewState — Caterpillar / unknown codes', () => {
    it('never requires review for REMISIONES_CATERPILLAR and never queries a repository for it', async () => {
      const { service, audiExecutions, paymentNotifications } = setup();
      const state = await service.getReviewState('REMISIONES_CATERPILLAR');
      expect(state).toEqual({ required: false, problemOccurredAt: null, problemOutcome: null });
      expect(audiExecutions.findLatestProblem).not.toHaveBeenCalled();
      expect(paymentNotifications.findLatestReviewWorthyExecution).not.toHaveBeenCalled();
    });
  });

  describe('acknowledge', () => {
    it('acknowledges the current outstanding Audi problem and propagates actor context/requestId', async () => {
      const { service, repository } = setup({ audiProblem: { ejecucion_id: '77', occurred_at: '2026-08-27T22:40:01.933Z', execution_state: 'ERROR' } });
      repository.acknowledge.mockResolvedValue({ acknowledgement_id: '9', reviewed_at: '2026-08-28T00:00:00.000Z', reviewed_by_email: 'user@daubert.mx' });

      const result = await service.acknowledge('REMISIONES_AUDI', 'req-1', identity);

      expect(repository.acknowledge).toHaveBeenCalledWith('REMISIONES_AUDI', 'AUDI_EXECUTION', '77', '2026-08-27T22:40:01.933Z', 'req-1', identity);
      expect(result).toEqual({
        automationCode: 'REMISIONES_AUDI',
        reviewRequired: false,
        reviewedAt: '2026-08-28T00:00:00.000Z',
        reviewedBy: { displayName: 'user@daubert.mx', email: 'user@daubert.mx' }
      });
    });

    it('is idempotent: does not insert again when the current problem is already acknowledged', async () => {
      const { service, repository } = setup({
        audiProblem: { ejecucion_id: '77', occurred_at: '2026-08-27T22:40:01.933Z', execution_state: 'ERROR' },
        acknowledgement: { acknowledgement_id: '9', reviewed_at: '2026-08-28T00:00:00.000Z', reviewed_by_email: 'other@daubert.mx' }
      });
      const result = await service.acknowledge('REMISIONES_AUDI', 'req-2', identity);
      expect(repository.acknowledge).not.toHaveBeenCalled();
      expect(result.reviewRequired).toBe(false);
      expect(result.reviewedBy?.email).toBe('other@daubert.mx');
    });

    it('is a safe no-op when there is no outstanding problem to acknowledge', async () => {
      const { service, repository } = setup();
      const result = await service.acknowledge('REMISIONES_AUDI', 'req-3', identity);
      expect(repository.acknowledge).not.toHaveBeenCalled();
      expect(result).toEqual({ automationCode: 'REMISIONES_AUDI', reviewRequired: false, reviewedAt: null, reviewedBy: null });
    });

    it('throws NotFoundException for an unknown automation code', async () => {
      const { service } = setup();
      await expect(service.acknowledge('NOT_A_REAL_AUTOMATION', 'req-4', identity)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException for REMISIONES_CATERPILLAR (NOT_INTEGRATED)', async () => {
      const { service, audiExecutions, paymentNotifications } = setup();
      await expect(service.acknowledge('REMISIONES_CATERPILLAR', 'req-5', identity)).rejects.toBeInstanceOf(BadRequestException);
      expect(audiExecutions.findLatestProblem).not.toHaveBeenCalled();
      expect(paymentNotifications.findLatestReviewWorthyExecution).not.toHaveBeenCalled();
    });

    it('never exposes a technical source reference in the response', async () => {
      const { service, repository } = setup({ audiProblem: { ejecucion_id: '77', occurred_at: '2026-08-27T22:40:01.933Z', execution_state: 'ERROR' } });
      repository.acknowledge.mockResolvedValue({ acknowledgement_id: '9', reviewed_at: '2026-08-28T00:00:00.000Z', reviewed_by_email: 'user@daubert.mx' });
      const result = await service.acknowledge('REMISIONES_AUDI', 'req-6', identity);
      expect(JSON.stringify(result)).not.toMatch(/77|ejecucion_id|source_reference|acknowledgement_id/i);
    });
  });
});
