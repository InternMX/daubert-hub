import { describe, expect, it, vi } from 'vitest';
import { AutomationsOverviewRepository } from '../src/automations/overview/automations-overview.repository';

describe('AutomationsOverviewRepository', () => {
  it('joins the newest execution per automation via a LEFT JOIN LATERAL, scoped to REMISIONES_AUDI', async () => {
    const query = vi.fn().mockResolvedValue([{ lifecycle_status: 'ACTIVA', execution_state: 'COMPLETADA', occurred_at: '2026-08-27T22:40:01.933Z' }]);
    const repository = new AutomationsOverviewRepository({ query } as never);

    await expect(repository.findAudiOverview()).resolves.toEqual({ lifecycle_status: 'ACTIVA', execution_state: 'COMPLETADA', occurred_at: '2026-08-27T22:40:01.933Z' });
    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain('FROM ops.automatizaciones automation');
    expect(sql).toContain('LEFT JOIN LATERAL');
    expect(sql).toContain('FROM ops.ejecuciones_automatizacion e');
    expect(sql).toContain("WHERE automation.codigo = 'REMISIONES_AUDI'");
    expect(sql).toContain('ORDER BY e.ejecucion_id DESC');
    expect(sql).toContain('LIMIT 1');
    expect(sql).not.toMatch(/n8n_execution_id|run_name|error_nodo|error_mensaje/i);
  });

  it('returns null when REMISIONES_AUDI is not registered', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const repository = new AutomationsOverviewRepository({ query } as never);
    await expect(repository.findAudiOverview()).resolves.toBeNull();
  });

  describe('findCaterpillarOverview (Phase 12A.3 §A)', () => {
    it('joins the newest execution per automation via a LEFT JOIN LATERAL, scoped to REMISIONES_CATERPILLAR', async () => {
      const query = vi.fn().mockResolvedValue([{ lifecycle_status: 'INACTIVA', execution_state: null, occurred_at: null }]);
      const repository = new AutomationsOverviewRepository({ query } as never);

      await expect(repository.findCaterpillarOverview()).resolves.toEqual({ lifecycle_status: 'INACTIVA', execution_state: null, occurred_at: null });
      const sql = query.mock.calls[0]?.[0] as string;
      expect(sql).toContain('FROM ops.automatizaciones automation');
      expect(sql).toContain('LEFT JOIN LATERAL');
      expect(sql).toContain("WHERE automation.codigo = 'REMISIONES_CATERPILLAR'");
      expect(sql).toContain('ORDER BY e.ejecucion_id DESC');
      expect(sql).toContain('LIMIT 1');
    });

    it('returns a normal row with a null execution when there are zero Caterpillar executions (not an error)', async () => {
      const query = vi.fn().mockResolvedValue([{ lifecycle_status: 'INACTIVA', execution_state: null, occurred_at: null }]);
      const repository = new AutomationsOverviewRepository({ query } as never);
      const result = await repository.findCaterpillarOverview();
      expect(result?.execution_state).toBeNull();
      expect(result?.lifecycle_status).toBe('INACTIVA');
    });

    it('returns null when REMISIONES_CATERPILLAR is not registered', async () => {
      const query = vi.fn().mockResolvedValue([]);
      const repository = new AutomationsOverviewRepository({ query } as never);
      await expect(repository.findCaterpillarOverview()).resolves.toBeNull();
    });
  });
});
