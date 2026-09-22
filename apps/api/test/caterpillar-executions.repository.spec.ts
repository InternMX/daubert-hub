import { describe, expect, it, vi } from 'vitest';
import { CaterpillarExecutionsRepository } from '../src/automations/remisiones-caterpillar/caterpillar-executions.repository';

describe('CaterpillarExecutionsRepository', () => {
  describe('list', () => {
    it('scopes both the count and list query to REMISIONES_CATERPILLAR, ordered newest-first and paginated', async () => {
      const query = vi.fn().mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
      const repository = new CaterpillarExecutionsRepository({ query } as never);

      await repository.list(2, 25);

      expect(query).toHaveBeenCalledTimes(2);
      const countSql = query.mock.calls[0]?.[0] as string;
      expect(countSql).toContain("automation.codigo = 'REMISIONES_CATERPILLAR'");

      const [listSql, values] = query.mock.calls[1]!;
      expect(listSql).toContain('FROM ops.ejecuciones_automatizacion execution');
      expect(listSql).toContain("automation.codigo = 'REMISIONES_CATERPILLAR'");
      expect(listSql).toContain('JOIN core.documentos documento');
      expect(listSql).toContain('ORDER BY execution.ejecucion_id DESC');
      expect(listSql).toContain('LIMIT $1 OFFSET $2');
      expect(values).toEqual([25, 25]);
      // Never derives routing/scoping by parsing operacion.series_documentales.codigo (Phase 12A.3 §B/§C).
      expect(listSql).not.toMatch(/series\.codigo|codigo\s+LIKE/i);
    });

    it('returns an empty list cleanly when there are zero executions (a normal, valid state)', async () => {
      const query = vi.fn().mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
      const repository = new CaterpillarExecutionsRepository({ query } as never);
      await expect(repository.list(1, 25)).resolves.toEqual({ total: 0, executions: [] });
    });

    it('returns total and executions, including the reservation serie_ids used for route resolution', async () => {
      const rows = [{ ejecucion_id: '1', execution_state: 'COMPLETADA', reservation_serie_ids: ['2'] }];
      const query = vi.fn().mockResolvedValueOnce([{ total: 1 }]).mockResolvedValueOnce(rows);
      const repository = new CaterpillarExecutionsRepository({ query } as never);
      await expect(repository.list(1, 25)).resolves.toEqual({ total: 1, executions: rows });
    });
  });

  describe('findById', () => {
    it('binds the executionId as a bigint-cast parameter and scopes to REMISIONES_CATERPILLAR', async () => {
      const query = vi.fn().mockResolvedValue([{ ejecucion_id: '77' }]);
      const repository = new CaterpillarExecutionsRepository({ query } as never);

      await expect(repository.findById('77')).resolves.toEqual({ ejecucion_id: '77' });
      const [sql, values] = query.mock.calls[0]!;
      expect(sql).toContain("automation.codigo = 'REMISIONES_CATERPILLAR'");
      expect(sql).toContain('WHERE execution.ejecucion_id = $1::bigint');
      expect(values).toEqual(['77']);
    });

    it('returns null when no execution matches (including one that belongs to a different automation)', async () => {
      const query = vi.fn().mockResolvedValue([]);
      const repository = new CaterpillarExecutionsRepository({ query } as never);
      await expect(repository.findById('999999')).resolves.toBeNull();
    });
  });

  describe('findReservationsByExecutionId', () => {
    it('binds the executionId as a bigint-cast parameter and joins the series code', async () => {
      const query = vi.fn().mockResolvedValue([]);
      const repository = new CaterpillarExecutionsRepository({ query } as never);
      await repository.findReservationsByExecutionId('77');
      const [sql, values] = query.mock.calls[0]!;
      expect(sql).toContain('FROM operacion.reservas_folios reserva');
      expect(sql).toContain('JOIN operacion.series_documentales serie');
      expect(sql).toContain('WHERE reserva.ejecucion_id = $1::bigint');
      expect(values).toEqual(['77']);
    });
  });

  describe('findRemissionsByExecutionId', () => {
    it('binds the executionId as a bigint-cast parameter and returns pdf_path as-is', async () => {
      const query = vi.fn().mockResolvedValue([]);
      const repository = new CaterpillarExecutionsRepository({ query } as never);
      await repository.findRemissionsByExecutionId('77');
      const [sql, values] = query.mock.calls[0]!;
      expect(sql).toContain('FROM operacion.remisiones remision');
      expect(sql).toContain('remision.pdf_path AS pdf_path');
      expect(sql).toContain('WHERE remision.ejecucion_id = $1::bigint');
      expect(values).toEqual(['77']);
    });
  });

  describe('findDetailsByRemisionIds', () => {
    it('binds remisionIds as a single parameterized bigint[] array', async () => {
      const query = vi.fn().mockResolvedValue([]);
      const repository = new CaterpillarExecutionsRepository({ query } as never);
      await repository.findDetailsByRemisionIds(['10', '11']);
      const [sql, values] = query.mock.calls[0]!;
      expect(sql).toContain('WHERE detalle.remision_id = ANY($1::bigint[])');
      expect(values).toEqual([['10', '11']]);
    });

    it('returns an empty array without querying when there are no remission ids', async () => {
      const query = vi.fn();
      const repository = new CaterpillarExecutionsRepository({ query } as never);
      await expect(repository.findDetailsByRemisionIds([])).resolves.toEqual([]);
      expect(query).not.toHaveBeenCalled();
    });
  });
});
