import { describe, expect, it, vi } from 'vitest';
import { RemisionesAudiActivityRepository } from '../src/recent-activity/remisiones-audi-activity.repository';

describe('RemisionesAudiActivityRepository', () => {
  it('returns bounded terminal Audi executions with one aggregate row per execution', async () => {
    const rows = [{
      execution_id: '42', automation_name: 'Remisiones Audi', execution_state: 'COMPLETADA', run_name: null,
      occurred_at: '2026-08-28T10:00:00.000Z', error_node: null, error_message: null,
      generated_count: 5, minimum_folio: '969', maximum_folio: '973'
    }];
    const query = vi.fn().mockResolvedValue(rows);
    const repository = new RemisionesAudiActivityRepository({ query } as never);

    await expect(repository.findRecent(6)).resolves.toEqual(rows);

    expect(query).toHaveBeenCalledWith(expect.any(String), [30]);
    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("automation.codigo = 'REMISIONES_AUDI'");
    expect(sql).toContain("series.codigo = 'REMISION_AUDI'");
    expect(sql).toContain("count(*) FILTER (WHERE remission.estatus = 'GENERADA')::int");
    expect(sql).toContain("min(remission.folio) FILTER (WHERE remission.estatus = 'GENERADA')");
    expect(sql).toContain("max(remission.folio) FILTER (WHERE remission.estatus = 'GENERADA')");
    expect(sql).toContain('GROUP BY remission.ejecucion_id');
    expect(sql).toContain('LEFT JOIN remission_summary summary');
    expect(sql).toContain('execution.n8n_execution_id IS NOT NULL');
  });

  it('retains completed live executions with zero remissions and excludes historical and nonterminal executions', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const repository = new RemisionesAudiActivityRepository({ query } as never);

    await repository.findRecent(2);

    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain('COALESCE(summary.generated_count, 0) AS generated_count');
    expect(sql).toContain("execution.estado IN ('COMPLETADA', 'ERROR', 'CANCELADA')");
    expect(sql).toContain('execution.n8n_execution_id IS NOT NULL');
    expect(sql).not.toContain("'PROCESANDO'");
    expect(sql).toContain('ORDER BY occurred_at DESC, execution.ejecucion_id DESC');
    expect(sql).toContain('LIMIT $1');
    expect(query).toHaveBeenCalledWith(expect.any(String), [10]);
  });

  it('does not multiply executions through remission details or source documents', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const repository = new RemisionesAudiActivityRepository({ query } as never);

    await repository.findRecent(1);

    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain('FROM ops.ejecuciones_automatizacion execution');
    expect(sql).toContain('FROM operacion.remisiones remission');
    expect(sql).not.toContain('remision_detalle');
    expect(sql).not.toContain('core.documentos');
  });
});
