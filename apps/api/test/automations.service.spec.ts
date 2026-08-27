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

  it('maps an unchanged folio to a clear conflict', async () => {
    const repository = { adjustNextFolio: vi.fn().mockRejectedValue({ code: 'DOCUMENT_SERIES_FOLIO_UNCHANGED' }) };
    const service = new AutomationsService(repository as never);
    await expect(service.adjustDocumentSeries('AUTO', 'SERIES', { nextFolio: 994, reason: 'Motivo' }, 'request-1')).rejects.toMatchObject({ status: 409, response: { code: 'DOCUMENT_SERIES_FOLIO_UNCHANGED' } });
  });
});
