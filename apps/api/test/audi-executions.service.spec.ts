import { describe, expect, it, vi } from 'vitest';
import { AudiExecutionsService } from '../src/automations/remisiones-audi/audi-executions.service';
import { untrustedAudiDiagnostics } from './support/audi-diagnostic-fixtures';

function row(overrides: Partial<{ ejecucion_id: string; occurred_at: string; execution_state: string; generated_count: number; minimum_folio: string | null; maximum_folio: string | null }> = {}) {
  return {
    ejecucion_id: '10',
    occurred_at: '2026-08-27T22:40:01.933Z',
    execution_state: 'COMPLETADA',
    generated_count: 5,
    minimum_folio: '9000',
    maximum_folio: '9004',
    ...overrides
  };
}

function setup(total: number, executions: ReturnType<typeof row>[], options: { currentProblem?: { ejecucion_id: string; occurred_at: string; execution_state: string } | null; acknowledged?: boolean } = {}) {
  const repository = {
    list: vi.fn().mockResolvedValue({ total, executions }),
    findLatestProblem: vi.fn().mockResolvedValue(options.currentProblem ?? null)
  };
  const reviewAcknowledgements = { findLatest: vi.fn().mockResolvedValue(options.acknowledged ? { acknowledgement_id: '1' } : null) };
  return { service: new AudiExecutionsService(repository as never, reviewAcknowledgements as never), repository, reviewAcknowledgements };
}

describe('AudiExecutionsService', () => {
  describe('detail diagnostic disclosure', () => {
    const execution = {
      ejecucion_id: '8', execution_state: 'COMPLETADA', started_at: '2026-08-27T22:39:53.204Z',
      finished_at: '2026-08-27T22:40:01.933Z', error_message: null, documento_id: '103', source_filename: 'entrada.xlsx'
    };
    const remission = { remision_id: '12', serie_codigo: 'REMISION_AUDI', folio: '9000', document_date: '2026-08-27', estatus: 'GENERADA' };
    const expectedData = {
      executionId: '8', outcome: 'COMPLETED', startedAt: execution.started_at, finishedAt: execution.finished_at,
      generatedCount: 1, sourceDocument: { documentId: '103', filename: 'entrada.xlsx' }, latestErrorMessage: null,
      remittances: [{ remissionId: '12', seriesCode: 'REMISION_AUDI', folio: '9000', documentDate: '2026-08-27', status: 'GENERADA' }]
    };

    function detailService(message: string | null) {
      return new AudiExecutionsService({
        findById: vi.fn().mockResolvedValue({ ...execution, error_message: message }),
        findRemissionsByExecutionId: vi.fn().mockResolvedValue([remission])
      } as never, {} as never);
    }

    it('keeps completed executions, remissions and null diagnostics unchanged', async () => {
      await expect(detailService(null).getDetail('8')).resolves.toEqual({ data: expectedData });
    });

    it.each(untrustedAudiDiagnostics)('withholds $label from every response field without changing remissions', async ({ message, fragments }) => {
      const response = await detailService(message).getDetail('8');
      expect(response).toEqual({ data: {
        ...expectedData, latestErrorMessage: 'La ejecución registró un error. Consulta los registros autorizados para más información.'
      } });
      const serialized = JSON.stringify(response);
      for (const fragment of fragments) expect(serialized).not.toContain(fragment);
      expect(serialized).not.toContain(message);
    });
  });

  it('maps pagination meta', async () => {
    const { service, repository } = setup(30, [row()]);
    const result = await service.list({ page: 2, pageSize: 10 });
    expect(repository.list).toHaveBeenCalledWith(2, 10);
    expect(result.meta).toEqual({ page: 2, pageSize: 10, total: 30, totalPages: 3 });
  });

  it.each([
    ['COMPLETADA', 'COMPLETED'],
    ['ERROR', 'FAILED'],
    ['PROCESANDO', 'PROCESSING'],
    ['CANCELADA', 'CANCELLED']
  ] as const)('maps execution_state %s to outcome %s', async (executionState, expected) => {
    const { service } = setup(1, [row({ execution_state: executionState })]);
    const result = await service.list({ page: 1, pageSize: 25 });
    expect(result.data[0]?.outcome).toBe(expected);
  });

  it('maps generatedCount, firstFolio, and lastFolio as BIGINT-safe strings', async () => {
    const { service } = setup(1, [row({ generated_count: 5, minimum_folio: '9000', maximum_folio: '9004' })]);
    const result = await service.list({ page: 1, pageSize: 25 });
    expect(result.data[0]).toMatchObject({ generatedCount: 5, firstFolio: '9000', lastFolio: '9004' });
    expect(typeof result.data[0]?.firstFolio).toBe('string');
  });

  it('reports zero generated remissions with null folios, never a fabricated range', async () => {
    const { service } = setup(1, [row({ generated_count: 0, minimum_folio: null, maximum_folio: null })]);
    const result = await service.list({ page: 1, pageSize: 25 });
    expect(result.data[0]).toMatchObject({ generatedCount: 0, firstFolio: null, lastFolio: null });
  });

  it('reports a single generated folio as firstFolio === lastFolio', async () => {
    const { service } = setup(1, [row({ generated_count: 1, minimum_folio: '9005', maximum_folio: '9005' })]);
    const result = await service.list({ page: 1, pageSize: 25 });
    expect(result.data[0]).toMatchObject({ firstFolio: '9005', lastFolio: '9005' });
  });

  it('converts occurred_at to an ISO string', async () => {
    const { service } = setup(1, [row({ occurred_at: '2026-08-27T22:40:01.933Z' })]);
    const result = await service.list({ page: 1, pageSize: 25 });
    expect(result.data[0]?.occurredAt).toBe('2026-08-27T22:40:01.933Z');
  });

  it('exposes only the bigint-safe execution identity and existing summary fields', async () => {
    const { service } = setup(1, [row({ ejecucion_id: '9007199254740993' })]);
    const result = await service.list({ page: 1, pageSize: 25 });
    expect(result.data[0]?.executionId).toBe('9007199254740993');
    expect(Object.keys(result.data[0]!).sort()).toEqual(['executionId', 'firstFolio', 'generatedCount', 'lastFolio', 'occurredAt', 'outcome', 'reviewStatus']);
    expect(JSON.stringify(result)).not.toMatch(/n8n_execution_id|run_name|error_nodo|error_mensaje|ejecucion_id|automatizacion_id|documento_origen_id|reproceso_de_id|acknowledgement_id/i);
  });

  describe('reviewStatus (Phase 10I UX refinement)', () => {
    it('marks the row matching the current unacknowledged problem as REQUIRED', async () => {
      const { service } = setup(2, [
        row({ ejecucion_id: '20', execution_state: 'ERROR' }),
        row({ ejecucion_id: '19', execution_state: 'COMPLETADA' })
      ], { currentProblem: { ejecucion_id: '20', occurred_at: '2026-08-27T22:40:01.933Z', execution_state: 'ERROR' }, acknowledged: false });
      const result = await service.list({ page: 1, pageSize: 25 });
      expect(result.data[0]?.reviewStatus).toBe('REQUIRED');
      expect(result.data[1]?.reviewStatus).toBeNull();
    });

    it('marks the row matching the current acknowledged problem as REVIEWED', async () => {
      const { service } = setup(1, [row({ ejecucion_id: '20', execution_state: 'ERROR' })], {
        currentProblem: { ejecucion_id: '20', occurred_at: '2026-08-27T22:40:01.933Z', execution_state: 'ERROR' },
        acknowledged: true
      });
      const result = await service.list({ page: 1, pageSize: 25 });
      expect(result.data[0]?.reviewStatus).toBe('REVIEWED');
    });

    it('never marks an older FAILED/CANCELLED row that is not the current problem — no independent per-row derivation', async () => {
      // An older ERROR row (19) exists but findLatestProblem only ever resolves the newest one
      // (20) — 19 must stay null (neither actionable nor "Revisado"), even though it shares the
      // same outcome-based shape.
      const { service } = setup(2, [
        row({ ejecucion_id: '20', execution_state: 'COMPLETADA' }),
        row({ ejecucion_id: '19', execution_state: 'ERROR' })
      ], { currentProblem: null });
      const result = await service.list({ page: 1, pageSize: 25 });
      expect(result.data[0]?.reviewStatus).toBeNull();
      expect(result.data[1]?.reviewStatus).toBeNull();
    });

    it('is null on every row when there is no current problem at all', async () => {
      const { service } = setup(1, [row({ execution_state: 'COMPLETADA' })], { currentProblem: null });
      const result = await service.list({ page: 1, pageSize: 25 });
      expect(result.data[0]?.reviewStatus).toBeNull();
    });

    it('looks up the acknowledgement using the AUDI_EXECUTION source type and the resolved ejecucion_id', async () => {
      const { service, reviewAcknowledgements } = setup(1, [row({ ejecucion_id: '20', execution_state: 'ERROR' })], {
        currentProblem: { ejecucion_id: '20', occurred_at: '2026-08-27T22:40:01.933Z', execution_state: 'ERROR' }
      });
      await service.list({ page: 1, pageSize: 25 });
      expect(reviewAcknowledgements.findLatest).toHaveBeenCalledWith('REMISIONES_AUDI', 'AUDI_EXECUTION', '20');
    });

    it('does not look up an acknowledgement at all when there is no current problem', async () => {
      const { service, reviewAcknowledgements } = setup(1, [row()], { currentProblem: null });
      await service.list({ page: 1, pageSize: 25 });
      expect(reviewAcknowledgements.findLatest).not.toHaveBeenCalled();
    });
  });
});
