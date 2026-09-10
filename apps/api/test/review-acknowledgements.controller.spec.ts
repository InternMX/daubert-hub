import { describe, expect, it, vi } from 'vitest';
import { ReviewAcknowledgementsController } from '../src/automations/review/review-acknowledgements.controller';

describe('ReviewAcknowledgementsController', () => {
  it('delegates to the service with the automation code, requestId, and actor identity from the request', async () => {
    const acknowledge = vi.fn().mockResolvedValue({ automationCode: 'REMISIONES_AUDI', reviewRequired: false, reviewedAt: '2026-08-28T00:00:00.000Z', reviewedBy: { displayName: 'user@daubert.mx', email: 'user@daubert.mx' } });
    const controller = new ReviewAcknowledgementsController({ acknowledge } as never);
    const request = { requestId: 'req-1', user: { id: '5', email: 'user@daubert.mx' } };

    const result = await controller.acknowledge('REMISIONES_AUDI', request as never);

    expect(acknowledge).toHaveBeenCalledWith('REMISIONES_AUDI', 'req-1', { userId: '5', userEmail: 'user@daubert.mx' });
    expect(result.automationCode).toBe('REMISIONES_AUDI');
  });

  it('passes null identity fields through when the request has no authenticated user (should not normally happen past AuthGuard)', async () => {
    const acknowledge = vi.fn().mockResolvedValue({ automationCode: 'REMISIONES_AUDI', reviewRequired: false, reviewedAt: null, reviewedBy: null });
    const controller = new ReviewAcknowledgementsController({ acknowledge } as never);
    const request = { requestId: 'req-2' };

    await controller.acknowledge('REMISIONES_AUDI', request as never);

    expect(acknowledge).toHaveBeenCalledWith('REMISIONES_AUDI', 'req-2', { userId: null, userEmail: null });
  });
});
