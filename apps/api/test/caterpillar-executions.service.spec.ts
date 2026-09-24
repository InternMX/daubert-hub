import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CaterpillarExecutionsService } from '../src/automations/remisiones-caterpillar/caterpillar-executions.service';
import type { CaterpillarProcessRoute } from '../src/automations/remisiones-caterpillar/caterpillar-routing.service';

const p2Route: CaterpillarProcessRoute = {
  routeId: '1', processKey: 'CATERPILLAR_P2|P2|', processLabel: 'P2', routeStatus: 'ACTIVE',
  seriesId: '2', seriesCode: 'REMISION_CAT_P2', seriesStatus: 'ACTIVE', nextFolio: 85,
  clientCompanyId: '122', clientCompanyName: 'CATERPILLAR'
};
const torreonRoute: CaterpillarProcessRoute = {
  routeId: '9', processKey: 'CAT_TORREON|TORREON|', processLabel: 'Torreón', routeStatus: 'ACTIVE',
  seriesId: '9', seriesCode: 'REMISION_CAT_TORREON', seriesStatus: 'INACTIVE', nextFolio: 778,
  clientCompanyId: '122', clientCompanyName: 'CATERPILLAR'
};
const torreonPlanta2Route: CaterpillarProcessRoute = { ...torreonRoute, routeId: '8', processKey: 'CAT_TORREON|TORREON|PLANTA_2', processLabel: 'Torreón Planta 2' };

function setup(options: {
  listResult?: { total: number; executions: unknown[] };
  findByIdResult?: unknown;
  reservations?: unknown[];
  remissions?: unknown[];
  details?: unknown[];
  routes?: CaterpillarProcessRoute[];
  webhookResult?: unknown;
} = {}) {
  const repository = {
    list: vi.fn().mockResolvedValue(options.listResult ?? { total: 0, executions: [] }),
    findById: vi.fn().mockResolvedValue(options.findByIdResult ?? null),
    findReservationsByExecutionId: vi.fn().mockResolvedValue(options.reservations ?? []),
    findRemissionsByExecutionId: vi.fn().mockResolvedValue(options.remissions ?? []),
    findDetailsByRemisionIds: vi.fn().mockResolvedValue(options.details ?? [])
  };
  const routing = { listRoutes: vi.fn().mockResolvedValue(options.routes ?? [p2Route, torreonRoute, torreonPlanta2Route]) };
  const webhookClient = { triggerReprocess: vi.fn().mockResolvedValue(options.webhookResult ?? { kind: 'NOT_CONFIGURED' }) };
  const triggerRequests = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new CaterpillarExecutionsService(repository as never, routing as never, webhookClient as never, triggerRequests as never);
  return { service, repository, routing, webhookClient, triggerRequests };
}

const identity = { userId: '1', userEmail: 'admin@test.mx' };

describe('CaterpillarExecutionsService', () => {
  describe('list', () => {
    it('returns an empty list cleanly when there are zero executions — a normal valid state, not an error', async () => {
      const { service } = setup({ listResult: { total: 0, executions: [] } });
      const result = await service.list({ page: 1, pageSize: 25 });
      expect(result).toEqual({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } });
    });

    it('maps execution_state through the shared outcome vocabulary and keeps executionId a string', async () => {
      const row = {
        ejecucion_id: '9007199254740993', execution_state: 'COMPLETADA',
        started_at: '2026-09-20T10:00:00.000Z', finished_at: '2026-09-20T10:05:00.000Z',
        failed_attempts: 0, max_attempts: 2, error_node: null, error_message: null, n8n_execution_id: 'wf-1',
        documento_id: '55', source_filename: 'remision.pdf', generated_count: 3, minimum_folio: '85', maximum_folio: '87',
        reservation_serie_ids: null
      };
      const { service } = setup({ listResult: { total: 1, executions: [row] } });
      const { data } = await service.list({ page: 1, pageSize: 25 });
      expect(data[0]?.executionId).toBe('9007199254740993');
      expect(typeof data[0]?.executionId).toBe('string');
      expect(data[0]?.outcome).toBe('COMPLETED');
      expect(data[0]?.generatedRemissionCount).toBe(3);
      expect(data[0]?.minimumFolio).toBe('85');
      expect(data[0]?.maximumFolio).toBe('87');
    });

    it('resolves an unambiguous process label from the execution\'s single reserved series', async () => {
      const row = { ejecucion_id: '1', execution_state: 'COMPLETADA', started_at: '2026-09-20T10:00:00.000Z', finished_at: null, failed_attempts: 0, max_attempts: 2, error_node: null, error_message: null, n8n_execution_id: null, documento_id: '1', source_filename: 'f.pdf', generated_count: 0, minimum_folio: null, maximum_folio: null, reservation_serie_ids: ['2'] };
      const { service } = setup({ listResult: { total: 1, executions: [row] } });
      const { data } = await service.list({ page: 1, pageSize: 25 });
      expect(data[0]?.processLabel).toBe('P2');
    });

    it('never fabricates a process label when the reserved series is shared by two routes (Torreón)', async () => {
      const row = { ejecucion_id: '1', execution_state: 'COMPLETADA', started_at: '2026-09-20T10:00:00.000Z', finished_at: null, failed_attempts: 0, max_attempts: 2, error_node: null, error_message: null, n8n_execution_id: null, documento_id: '1', source_filename: 'f.pdf', generated_count: 0, minimum_folio: null, maximum_folio: null, reservation_serie_ids: ['9'] };
      const { service } = setup({ listResult: { total: 1, executions: [row] } });
      const { data } = await service.list({ page: 1, pageSize: 25 });
      expect(data[0]?.processLabel).toBeNull();
    });

    it('never fabricates a process label when there are no reservations at all', async () => {
      const row = { ejecucion_id: '1', execution_state: 'PROCESANDO', started_at: '2026-09-20T10:00:00.000Z', finished_at: null, failed_attempts: 0, max_attempts: 2, error_node: null, error_message: null, n8n_execution_id: null, documento_id: '1', source_filename: 'f.pdf', generated_count: 0, minimum_folio: null, maximum_folio: null, reservation_serie_ids: null };
      const { service } = setup({ listResult: { total: 1, executions: [row] } });
      const { data } = await service.list({ page: 1, pageSize: 25 });
      expect(data[0]?.processLabel).toBeNull();
    });

    it('fetches routes exactly once per list() call regardless of row count', async () => {
      const rows = [1, 2, 3].map((n) => ({ ejecucion_id: String(n), execution_state: 'COMPLETADA', started_at: '2026-09-20T10:00:00.000Z', finished_at: null, failed_attempts: 0, max_attempts: 2, error_node: null, error_message: null, n8n_execution_id: null, documento_id: '1', source_filename: 'f.pdf', generated_count: 0, minimum_folio: null, maximum_folio: null, reservation_serie_ids: null }));
      const { service, routing } = setup({ listResult: { total: 3, executions: rows } });
      await service.list({ page: 1, pageSize: 25 });
      expect(routing.listRoutes).toHaveBeenCalledTimes(1);
    });
  });

  describe('getDetail', () => {
    it('throws NotFoundException when the execution does not exist', async () => {
      const { service } = setup({ findByIdResult: null });
      await expect(service.getDetail('999999')).rejects.toBeInstanceOf(NotFoundException);
    });

    // CaterpillarExecutionsRepository.findById already scopes its JOIN to REMISIONES_CATERPILLAR
    // (see the repository spec), so an id belonging to a different automation (e.g. Audi) comes
    // back as the same null the "does not exist" case produces — this asserts the service turns
    // that null into the same 404, never a fabricated 200 for a cross-automation id.
    it('throws NotFoundException (never a 200) for an execution id belonging to a different automation, e.g. Audi', async () => {
      const { service, repository } = setup({ findByIdResult: null });
      await expect(service.getDetail('42')).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.findById).toHaveBeenCalledWith('42');
    });

    it('assembles the source document, reservations, and remittances with their details grouped correctly', async () => {
      const execution = {
        ejecucion_id: '5', execution_state: 'COMPLETADA', started_at: '2026-09-20T10:00:00.000Z', finished_at: '2026-09-20T10:05:00.000Z',
        failed_attempts: 0, max_attempts: 2, error_node: null, error_message: null, n8n_execution_id: 'wf-5', reproceso_de_id: null,
        documento_id: '55', source_filename: 'archivo.pdf', source_path: '/dropbox/cat/archivo.pdf', source_hash: 'abc123', source_origin: 'DROPBOX',
        source_document_date: '2026-09-19'
      };
      const reservations = [{ reserva_id: '1', serie_id: '2', serie_codigo: 'REMISION_CAT_P2', folio_inicial: '85', folio_final: '87', cantidad: 3, estatus: 'APLICADA' }];
      const remissions = [
        { remision_id: '100', serie_id: '2', serie_codigo: 'REMISION_CAT_P2', folio: '85', fecha_documento: '2026-09-19', pdf_path: '/dropbox/cat/85.pdf', estatus: 'GENERADA' },
        { remision_id: '101', serie_id: '2', serie_codigo: 'REMISION_CAT_P2', folio: '86', fecha_documento: '2026-09-19', pdf_path: null, estatus: 'GENERADA' }
      ];
      const details = [
        { detalle_id: '1', remision_id: '100', codigo_interno: 'X1', part_number: 'PN-1', descripcion: 'Parte 1', cantidad_texto: '2 PZA' },
        { detalle_id: '2', remision_id: '101', codigo_interno: null, part_number: 'PN-2', descripcion: null, cantidad_texto: '1 PZA' }
      ];
      const { service } = setup({ findByIdResult: execution, reservations, remissions, details });

      const { data } = await service.getDetail('5');

      expect(data.executionId).toBe('5');
      expect(data.outcome).toBe('COMPLETED');
      expect(data.sourceDocument).toEqual({ documentId: '55', filename: 'archivo.pdf', path: '/dropbox/cat/archivo.pdf', hash: 'abc123', origin: 'DROPBOX', documentDate: '2026-09-19' });
      expect(data.reservations).toEqual([{ reservationId: '1', seriesId: '2', seriesCode: 'REMISION_CAT_P2', folioInicial: '85', folioFinal: '87', quantity: 3, status: 'APLICADA' }]);
      expect(data.remittances).toHaveLength(2);
      expect(data.remittances[0]).toMatchObject({ remissionId: '100', folio: '85', pdfPath: '/dropbox/cat/85.pdf' });
      expect(data.remittances[0]?.details).toEqual([{ detailId: '1', internalCode: 'X1', partNumber: 'PN-1', description: 'Parte 1', quantityText: '2 PZA' }]);
      expect(data.remittances[1]).toMatchObject({ remissionId: '101', pdfPath: null });
      expect(data.remittances[1]?.details).toEqual([{ detailId: '2', internalCode: null, partNumber: 'PN-2', description: null, quantityText: '1 PZA' }]);
    });

    it('returns empty reservations/remittances arrays cleanly when none exist yet', async () => {
      const execution = {
        ejecucion_id: '5', execution_state: 'PROCESANDO', started_at: '2026-09-20T10:00:00.000Z', finished_at: null,
        failed_attempts: 0, max_attempts: 2, error_node: null, error_message: null, n8n_execution_id: null, reproceso_de_id: null,
        documento_id: '55', source_filename: 'archivo.pdf', source_path: '/dropbox/cat/archivo.pdf', source_hash: null, source_origin: 'DROPBOX', source_document_date: null
      };
      const { service, repository } = setup({ findByIdResult: execution, reservations: [], remissions: [] });
      const { data } = await service.getDetail('5');
      expect(data.reservations).toEqual([]);
      expect(data.remittances).toEqual([]);
      // No details query when there are zero remissions to look details up for.
      expect(repository.findDetailsByRemisionIds).not.toHaveBeenCalled();
    });

    it('never exposes a filesystem-opened value for pdf_path — plain text only', async () => {
      const execution = {
        ejecucion_id: '5', execution_state: 'COMPLETADA', started_at: '2026-09-20T10:00:00.000Z', finished_at: '2026-09-20T10:05:00.000Z',
        failed_attempts: 0, max_attempts: 2, error_node: null, error_message: null, n8n_execution_id: null, reproceso_de_id: null,
        documento_id: '55', source_filename: 'archivo.pdf', source_path: '/dropbox/cat/archivo.pdf', source_hash: null, source_origin: 'DROPBOX', source_document_date: null
      };
      const remissions = [{ remision_id: '100', serie_id: '2', serie_codigo: 'REMISION_CAT_P2', folio: '85', fecha_documento: '2026-09-19', pdf_path: '/dropbox/cat/85.pdf', estatus: 'GENERADA' }];
      const { service } = setup({ findByIdResult: execution, remissions });
      const { data } = await service.getDetail('5');
      expect(typeof data.remittances[0]?.pdfPath).toBe('string');
    });
  });

  describe('reprocess', () => {
    it('throws BadRequestException when the identity has no resolvable email, before ever calling the webhook', async () => {
      const { service, webhookClient } = setup();
      await expect(service.reprocess('153', 'motivo', 'req-1', { userId: null, userEmail: null })).rejects.toMatchObject({ status: 400 });
      expect(webhookClient.triggerReprocess).not.toHaveBeenCalled();
    });

    it('forwards only executionId and reason to the webhook client, nothing else', async () => {
      const { service, webhookClient } = setup({ webhookResult: { kind: 'ACCEPTED', status: 'REPROCESS_CREATED', originalExecutionId: '153', executionId: '154' } });
      await service.reprocess('153', 'motivo del reproceso', 'req-1', identity);
      expect(webhookClient.triggerReprocess).toHaveBeenCalledWith('153', 'motivo del reproceso');
    });

    it.each([
      ['REPROCESS_CREATED'],
      ['ALREADY_PROCESSING'],
      ['ALREADY_REPROCESSED']
    ] as const)('maps an ACCEPTED webhook result with status %s straight through, recording a TRIGGERED audit row', async (status) => {
      const { service, triggerRequests } = setup({ webhookResult: { kind: 'ACCEPTED', status, originalExecutionId: '153', executionId: '154' } });
      const result = await service.reprocess('153', 'motivo', 'req-1', identity);
      expect(result).toEqual({ outcome: status, originalExecutionId: '153', executionId: '154' });
      expect(triggerRequests.record).toHaveBeenCalledWith('REMISIONES_CATERPILLAR', 'REPROCESS', 'TRIGGERED', 'req-1', identity, '153');
    });

    it.each([
      ['NOT_FOUND'],
      ['NOT_ELIGIBLE_STATE'],
      ['SOURCE_FILE_MISSING'],
      ['OUTSIDE_TEST_SCOPE']
    ] as const)('maps a known REJECTED reason %s through unchanged, recording a NOTHING_TO_REPROCESS audit row and no child executionId', async (reason) => {
      const { service, triggerRequests } = setup({ webhookResult: { kind: 'REJECTED', reason } });
      const result = await service.reprocess('153', 'motivo', 'req-1', identity);
      expect(result).toEqual({ outcome: reason, originalExecutionId: '153', executionId: null });
      expect(triggerRequests.record).toHaveBeenCalledWith('REMISIONES_CATERPILLAR', 'REPROCESS', 'NOTHING_TO_REPROCESS', 'req-1', identity, '153');
    });

    it('maps a TIMEOUT webhook result to UPSTREAM_TIMEOUT, recording an UPSTREAM_ERROR audit row', async () => {
      const { service, triggerRequests } = setup({ webhookResult: { kind: 'TIMEOUT' } });
      const result = await service.reprocess('153', 'motivo', 'req-1', identity);
      expect(result).toEqual({ outcome: 'UPSTREAM_TIMEOUT', originalExecutionId: '153', executionId: null });
      expect(triggerRequests.record).toHaveBeenCalledWith('REMISIONES_CATERPILLAR', 'REPROCESS', 'UPSTREAM_ERROR', 'req-1', identity, '153');
    });

    it.each([
      ['NOT_CONFIGURED'],
      ['NETWORK_ERROR']
    ] as const)('maps webhook kind %s to UPSTREAM_UNAVAILABLE', async (kind) => {
      const { service } = setup({ webhookResult: { kind } });
      const result = await service.reprocess('153', 'motivo', 'req-1', identity);
      expect(result.outcome).toBe('UPSTREAM_UNAVAILABLE');
    });

    it('maps an INVALID_RESPONSE webhook result to UPSTREAM_INVALID_RESPONSE', async () => {
      const { service } = setup({ webhookResult: { kind: 'INVALID_RESPONSE' } });
      const result = await service.reprocess('153', 'motivo', 'req-1', identity);
      expect(result.outcome).toBe('UPSTREAM_INVALID_RESPONSE');
    });

    it('never lets an audit-write failure surface as a failed reprocess request (best-effort, swallowed)', async () => {
      const { service, triggerRequests } = setup({ webhookResult: { kind: 'ACCEPTED', status: 'REPROCESS_CREATED', originalExecutionId: '153', executionId: '154' } });
      triggerRequests.record.mockRejectedValueOnce(new Error('db unavailable'));
      const result = await service.reprocess('153', 'motivo', 'req-1', identity);
      expect(result).toEqual({ outcome: 'REPROCESS_CREATED', originalExecutionId: '153', executionId: '154' });
    });
  });
});
