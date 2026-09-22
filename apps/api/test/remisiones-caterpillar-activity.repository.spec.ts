import { describe, expect, it, vi } from 'vitest';
import { RemisionesCaterpillarActivityRepository } from '../src/recent-activity/remisiones-caterpillar-activity.repository';

describe('RemisionesCaterpillarActivityRepository', () => {
  it('returns a bounded chronological Caterpillar feed in one query', async () => {
    const rows = [{
      execution_id: '42', automation_name: 'Remisiones Caterpillar', execution_state: 'COMPLETADA',
      occurred_at: '2026-09-22T20:07:00.000Z', source_filename: 'source.pdf', process_key: 'CAT_P3_P4_P5_P6|P5|'
    }];
    const query = vi.fn().mockResolvedValue(rows);
    const repository = new RemisionesCaterpillarActivityRepository({ query } as never);

    await expect(repository.findRecent(6)).resolves.toEqual(rows);

    expect(query).toHaveBeenCalledWith(expect.any(String), [30]);
    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("automation.codigo = 'REMISIONES_CATERPILLAR'");
    expect(sql).toContain("execution.estado IN ('COMPLETADA', 'PROCESANDO', 'ERROR', 'CANCELADA')");
    expect(sql).toContain('COALESCE(execution.finalizada_en, execution.updated_at, execution.iniciada_en) AS occurred_at');
    expect(sql).toContain('ORDER BY occurred_at DESC, execution.ejecucion_id DESC');
    expect(sql).toContain('LIMIT $1');
  });

  it('resolves a process key only from one unambiguous reservation series without parsing filenames or series codes', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const repository = new RemisionesCaterpillarActivityRepository({ query } as never);

    await repository.findRecent(2);

    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain('array_agg(DISTINCT reservation.serie_id) AS series_ids');
    expect(sql).toContain('cardinality(reservation.series_ids) = 1');
    expect(sql).toContain('CASE WHEN count(*) = 1 THEN min(route.llave_proceso) END AS process_key');
    expect(sql).toContain('route.serie_id = reservation.series_ids[1]');
    expect(sql).toContain('document.nombre_archivo AS source_filename');
    expect(sql).not.toMatch(/REMISION_CAT_|ruta_archivo|Dropbox/i);
  });

  it('does not introduce per-execution detail or remission queries', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const repository = new RemisionesCaterpillarActivityRepository({ query } as never);

    await repository.findRecent(1);

    expect(query).toHaveBeenCalledOnce();
    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).not.toContain('remision_detalle');
    expect(sql).not.toContain('operacion.remisiones ');
  });
});
