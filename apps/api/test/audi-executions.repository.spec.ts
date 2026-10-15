import { describe, expect, it, vi } from 'vitest';
import { AudiExecutionsRepository } from '../src/automations/remisiones-audi/audi-executions.repository';

describe('AudiExecutionsRepository', () => {
  it('finds a single Audi execution by bound bigint id without requiring child records', async () => {
    const query = vi.fn().mockResolvedValue([{ ejecucion_id: '9007199254740993' }]);
    const repository = new AudiExecutionsRepository({ query } as never);
    await expect(repository.findById('9007199254740993')).resolves.toEqual({ ejecucion_id: '9007199254740993' });
    const [sql, params] = query.mock.calls[0]!;
    expect(params).toEqual(['9007199254740993']);
    expect(sql).toContain("automation.codigo = 'REMISIONES_AUDI'");
    expect(sql).toContain('LEFT JOIN core.documentos');
    expect(sql).toContain('WHERE execution.ejecucion_id = $1::bigint');
    expect(sql).not.toMatch(/JOIN operacion\.|ruta_archivo|pdf_path|run_name|payload/);
  });

  it('returns null for a missing or out-of-scope execution', async () => {
    const repository = new AudiExecutionsRepository({ query: vi.fn().mockResolvedValue([]) } as never);
    await expect(repository.findById('12')).resolves.toBeNull();
  });

  it('reads historical remissions and exact folios without reservations, articles or counters', async () => {
    const query = vi.fn().mockResolvedValue([]);
    await new AudiExecutionsRepository({ query } as never).findRemissionsByExecutionId('8');
    const [sql, params] = query.mock.calls[0]!;
    expect(params).toEqual(['8']);
    expect(sql).toContain("automation.codigo = 'REMISIONES_AUDI'");
    expect(sql).toContain("series.codigo = 'REMISION_AUDI'");
    expect(sql).toContain('WHERE remission.ejecucion_id = $1::bigint');
    expect(sql).toContain('remission.folio::text');
    expect(sql).not.toMatch(/remision_detalle|reservas_folios|siguiente_folio|pdf_path/);
  });

  it('scopes both the count and the list query to REMISIONES_AUDI, ordered newest-first and paginated', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ total: 3 }])
      .mockResolvedValueOnce([]);
    const repository = new AudiExecutionsRepository({ query } as never);

    await repository.list(2, 25);

    expect(query).toHaveBeenCalledTimes(2);
    const countSql = query.mock.calls[0]?.[0] as string;
    expect(countSql).toContain("automation.codigo = 'REMISIONES_AUDI'");

    const [listSql, values] = query.mock.calls[1]!;
    expect(listSql).toContain('FROM ops.ejecuciones_automatizacion execution');
    expect(listSql).toContain("automation.codigo = 'REMISIONES_AUDI'");
    expect(listSql).toContain("series.codigo = 'REMISION_AUDI'");
    expect(listSql).toContain('ORDER BY execution.ejecucion_id DESC');
    expect(listSql).toContain('LIMIT $1 OFFSET $2');
    expect(values).toEqual([25, 25]);
    expect(listSql).not.toMatch(/n8n_execution_id|run_name|error_nodo|error_mensaje|documento_origen_id|reproceso_de_id/i);
  });

  it('does not require a synced n8n_execution_id or a terminal state, unlike the Recent Activity feed', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
    const repository = new AudiExecutionsRepository({ query } as never);
    await repository.list(1, 25);
    const listSql = query.mock.calls[1]?.[0] as string;
    expect(listSql).not.toContain('n8n_execution_id IS NOT NULL');
    expect(listSql).not.toContain("estado IN (");
  });

  it('returns total and executions from the two queries', async () => {
    const rows = [{ occurred_at: '2026-08-27T22:40:01.933Z', execution_state: 'COMPLETADA', generated_count: 5, minimum_folio: '9000', maximum_folio: '9004' }];
    const query = vi.fn().mockResolvedValueOnce([{ total: 1 }]).mockResolvedValueOnce(rows);
    const repository = new AudiExecutionsRepository({ query } as never);
    await expect(repository.list(1, 25)).resolves.toEqual({ total: 1, executions: rows });
  });

  describe('findLatestProblem (Phase 10I)', () => {
    it('scopes to REMISIONES_AUDI, filters to ERROR/CANCELADA, and orders by ejecucion_id DESC', async () => {
      const query = vi.fn().mockResolvedValue([]);
      const repository = new AudiExecutionsRepository({ query } as never);
      await repository.findLatestProblem();
      const sql = query.mock.calls[0]?.[0] as string;
      expect(sql).toContain("automation.codigo = 'REMISIONES_AUDI'");
      expect(sql).toContain("WHERE execution.estado IN ('ERROR', 'CANCELADA')");
      expect(sql).toContain('ORDER BY execution.ejecucion_id DESC');
      expect(sql).toContain('LIMIT 1');
    });

    it('returns the row when one exists', async () => {
      const row = { ejecucion_id: '77', occurred_at: '2026-08-27T22:40:01.933Z', execution_state: 'ERROR' };
      const query = vi.fn().mockResolvedValue([row]);
      const repository = new AudiExecutionsRepository({ query } as never);
      await expect(repository.findLatestProblem()).resolves.toEqual(row);
    });

    it('returns null when there is no ERROR/CANCELADA execution', async () => {
      const query = vi.fn().mockResolvedValue([]);
      const repository = new AudiExecutionsRepository({ query } as never);
      await expect(repository.findLatestProblem()).resolves.toBeNull();
    });
  });
});
