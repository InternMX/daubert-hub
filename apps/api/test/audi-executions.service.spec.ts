import { describe, expect, it, vi } from 'vitest';
import { AudiExecutionsService } from '../src/automations/remisiones-audi/audi-executions.service';

function row(overrides: Partial<{ occurred_at: string; execution_state: string; generated_count: number; minimum_folio: string | null; maximum_folio: string | null }> = {}) {
  return {
    occurred_at: '2026-08-27T22:40:01.933Z',
    execution_state: 'COMPLETADA',
    generated_count: 5,
    minimum_folio: '9000',
    maximum_folio: '9004',
    ...overrides
  };
}

function setup(total: number, executions: ReturnType<typeof row>[]) {
  const repository = { list: vi.fn().mockResolvedValue({ total, executions }) };
  return { service: new AudiExecutionsService(repository as never), repository };
}

describe('AudiExecutionsService', () => {
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

  it('never exposes technical/internal identifiers or diagnostics', async () => {
    const { service } = setup(1, [row()]);
    const result = await service.list({ page: 1, pageSize: 25 });
    expect(Object.keys(result.data[0]!).sort()).toEqual(['firstFolio', 'generatedCount', 'lastFolio', 'occurredAt', 'outcome']);
    expect(JSON.stringify(result)).not.toMatch(/n8n_execution_id|run_name|error_nodo|error_mensaje|ejecucion_id|automatizacion_id|documento_origen_id|reproceso_de_id/i);
  });
});
