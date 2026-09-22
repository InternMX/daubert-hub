import { describe, expect, it, vi } from 'vitest';
import { AutomationsService } from '../src/automations/automations.service';

const configuration = {
  automation: { codigo: 'REMISIONES_AUDI', nombre: 'Remisiones Audi', estatus: 'ACTIVO' },
  series: { serie_id: '42', codigo: 'REMISION_AUDI', nombre: 'Remisión Audi', siguiente_folio: 994, estatus: 'ACTIVO' },
  adjustments: [
    { siguiente_folio_anterior: 995, siguiente_folio_nuevo: 994, motivo: 'Segundo', usuario_email: null, created_at: '2026-08-27T12:00:00.000Z' },
    { siguiente_folio_anterior: 994, siguiente_folio_nuevo: 995, motivo: 'Primero', usuario_email: 'admin@example.test', created_at: '2026-08-27T11:00:00.000Z' }
  ]
};

const forwardInput = { expectedCurrentFolio: 994, nextFolio: 1000, reason: 'Motivo' };

describe('AutomationsService', () => {
  it('maps only the Audi automation, series, and newest-first adjustment fields', async () => {
    const service = new AutomationsService({ findConfiguration: vi.fn().mockResolvedValue(configuration) } as never);
    await expect(service.getDocumentSeries('REMISIONES_AUDI', 'REMISION_AUDI')).resolves.toEqual({ data: {
      automation: { code: 'REMISIONES_AUDI', name: 'Remisiones Audi', status: 'ACTIVO' },
      series: { code: 'REMISION_AUDI', name: 'Remisión Audi', nextFolio: 994, status: 'ACTIVO' },
      adjustments: [
        { previousFolio: 995, newFolio: 994, reason: 'Segundo', userEmail: null, createdAt: '2026-08-27T12:00:00.000Z' },
        { previousFolio: 994, newFolio: 995, reason: 'Primero', userEmail: 'admin@example.test', createdAt: '2026-08-27T11:00:00.000Z' }
      ]
    } });
  });

  it('passes the full input object (expectedCurrentFolio, nextFolio, reason, backwardFilesystemAcknowledged) through to the repository', async () => {
    const repository = { adjustNextFolio: vi.fn().mockResolvedValue(undefined), findConfiguration: vi.fn().mockResolvedValue(configuration) };
    const service = new AutomationsService(repository as never);
    const input = { expectedCurrentFolio: 994, nextFolio: 990, reason: 'Corrección', backwardFilesystemAcknowledged: true };
    await service.adjustDocumentSeries('REMISIONES_AUDI', 'REMISION_AUDI', input, 'request-0', { userId: '5', userEmail: 'admin@daubert.mx' });
    expect(repository.adjustNextFolio).toHaveBeenCalledWith('REMISIONES_AUDI', 'REMISION_AUDI', input, 'request-0', { userId: '5', userEmail: 'admin@daubert.mx' });
  });

  it('maps an unknown automation/series (including an ownership mismatch) to 404', async () => {
    const repository = { adjustNextFolio: vi.fn().mockRejectedValue({ code: 'DOCUMENT_SERIES_NOT_FOUND' }) };
    const service = new AutomationsService(repository as never);
    await expect(service.adjustDocumentSeries('REMISIONES_CATERPILLAR', 'REMISION_AUDI', forwardInput, 'request-1', { userId: null, userEmail: null })).rejects.toMatchObject({ status: 404 });
  });

  it('maps an unchanged folio to a clear conflict', async () => {
    const repository = { adjustNextFolio: vi.fn().mockRejectedValue({ code: 'DOCUMENT_SERIES_FOLIO_UNCHANGED' }) };
    const service = new AutomationsService(repository as never);
    await expect(service.adjustDocumentSeries('AUTO', 'SERIES', { expectedCurrentFolio: 994, nextFolio: 994, reason: 'Motivo' }, 'request-1', { userId: null, userEmail: null })).rejects.toMatchObject({ status: 409, response: { code: 'DOCUMENT_SERIES_FOLIO_UNCHANGED' } });
  });

  it('maps a stale expectedCurrentFolio to 409 SERIES_FOLIO_STALE', async () => {
    const repository = { adjustNextFolio: vi.fn().mockRejectedValue({ code: 'SERIES_FOLIO_STALE' }) };
    const service = new AutomationsService(repository as never);
    await expect(service.adjustDocumentSeries('AUTO', 'SERIES', forwardInput, 'request-2', { userId: null, userEmail: null })).rejects.toMatchObject({ status: 409, response: { code: 'SERIES_FOLIO_STALE' } });
  });

  it('maps a missing backward acknowledgement to 400 BACKWARD_ACKNOWLEDGEMENT_REQUIRED', async () => {
    const repository = { adjustNextFolio: vi.fn().mockRejectedValue({ code: 'BACKWARD_ACKNOWLEDGEMENT_REQUIRED' }) };
    const service = new AutomationsService(repository as never);
    await expect(service.adjustDocumentSeries('AUTO', 'SERIES', forwardInput, 'request-3', { userId: null, userEmail: null })).rejects.toMatchObject({ status: 400, response: { code: 'BACKWARD_ACKNOWLEDGEMENT_REQUIRED' } });
  });

  it('maps an unconfigured floor to 409 SERIES_FOLIO_FLOOR_UNCONFIGURED', async () => {
    const repository = { adjustNextFolio: vi.fn().mockRejectedValue({ code: 'SERIES_FOLIO_FLOOR_UNCONFIGURED' }) };
    const service = new AutomationsService(repository as never);
    await expect(service.adjustDocumentSeries('AUTO', 'SERIES', forwardInput, 'request-4', { userId: null, userEmail: null })).rejects.toMatchObject({ status: 409, response: { code: 'SERIES_FOLIO_FLOOR_UNCONFIGURED' } });
  });

  it('maps a forward below-floor target to 409 SERIES_FOLIO_BELOW_FLOOR', async () => {
    const repository = { adjustNextFolio: vi.fn().mockRejectedValue({ code: 'SERIES_FOLIO_BELOW_FLOOR' }) };
    const service = new AutomationsService(repository as never);
    await expect(service.adjustDocumentSeries('AUTO', 'SERIES', { expectedCurrentFolio: 1, nextFolio: 100, reason: 'Motivo' }, 'request-5', { userId: null, userEmail: null })).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'SERIES_FOLIO_BELOW_FLOOR',
        message: 'El nuevo folio está por debajo del límite histórico seguro configurado para esta serie.'
      }
    });
  });

  it('maps a remission-range conflict to 409 SERIES_FOLIO_REMISSION_CONFLICT', async () => {
    const repository = { adjustNextFolio: vi.fn().mockRejectedValue({ code: 'SERIES_FOLIO_REMISSION_CONFLICT' }) };
    const service = new AutomationsService(repository as never);
    await expect(service.adjustDocumentSeries('AUTO', 'SERIES', forwardInput, 'request-6', { userId: null, userEmail: null })).rejects.toMatchObject({ status: 409, response: { code: 'SERIES_FOLIO_REMISSION_CONFLICT' } });
  });

  it('maps a reservation-range conflict to 409 SERIES_FOLIO_RESERVATION_CONFLICT', async () => {
    const repository = { adjustNextFolio: vi.fn().mockRejectedValue({ code: 'SERIES_FOLIO_RESERVATION_CONFLICT' }) };
    const service = new AutomationsService(repository as never);
    await expect(service.adjustDocumentSeries('AUTO', 'SERIES', forwardInput, 'request-7', { userId: null, userEmail: null })).rejects.toMatchObject({ status: 409, response: { code: 'SERIES_FOLIO_RESERVATION_CONFLICT' } });
  });

  it('propagates an unmapped error unchanged (consistent-failure convention)', async () => {
    const failure = new Error('unexpected');
    const repository = { adjustNextFolio: vi.fn().mockRejectedValue(failure) };
    const service = new AutomationsService(repository as never);
    await expect(service.adjustDocumentSeries('AUTO', 'SERIES', forwardInput, 'request-8', { userId: null, userEmail: null })).rejects.toBe(failure);
  });
});
