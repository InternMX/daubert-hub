import { describe, expect, it, vi } from 'vitest';
import { AutomationsController } from '../src/automations/automations.controller';
import { ROLES_KEY } from '../src/security/route-access.decorators';

describe('AutomationsController', () => {
  it('delegates getDocumentSeries with the raw automation/series codes', async () => {
    const getDocumentSeries = vi.fn().mockResolvedValue({ data: {} });
    const controller = new AutomationsController({ getDocumentSeries } as never);
    await controller.getDocumentSeries('REMISIONES_CATERPILLAR', 'REMISION_CAT_P5');
    expect(getDocumentSeries).toHaveBeenCalledWith('REMISIONES_CATERPILLAR', 'REMISION_CAT_P5');
  });

  it('delegates adjustDocumentSeries with the DTO, requestId, and audit identity', async () => {
    const adjustDocumentSeries = vi.fn().mockResolvedValue({ data: {} });
    const controller = new AutomationsController({ adjustDocumentSeries } as never);
    const input = { expectedCurrentFolio: 124, nextFolio: 130, reason: 'Corrección', backwardFilesystemAcknowledged: false };
    const request = { requestId: 'req-1', user: { id: '5', email: 'admin@daubert.mx' } };
    await controller.adjustDocumentSeries('REMISIONES_CATERPILLAR', 'REMISION_CAT_P5', input, request as never);
    expect(adjustDocumentSeries).toHaveBeenCalledWith('REMISIONES_CATERPILLAR', 'REMISION_CAT_P5', input, 'req-1', { userId: '5', userEmail: 'admin@daubert.mx' });
  });

  // Phase 12B.2 §F: ADMIN-only, method-level only — GET stays open to both ADMIN and GENERAL.
  // This is the wiring RolesGuard (tested generically in roles.guard.spec.ts) enforces at runtime.
  it('requires @Roles(\'ADMIN\') on adjustDocumentSeries (PATCH) only, never on getDocumentSeries (GET)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AutomationsController.prototype.adjustDocumentSeries)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(ROLES_KEY, AutomationsController.prototype.getDocumentSeries)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, AutomationsController)).toBeUndefined();
  });
});
