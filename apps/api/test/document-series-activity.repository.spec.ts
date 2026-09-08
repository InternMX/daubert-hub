import { describe, expect, it, vi } from 'vitest';
import { DocumentSeriesActivityRepository } from '../src/recent-activity/document-series-activity.repository';

describe('DocumentSeriesActivityRepository', () => {
  it('reads recent folio adjustments from the dedicated ledger, with before/after and actor snapshot', async () => {
    const rows = [{ id: '1', series_name: 'Remisiones Audi', folio_before: '951', folio_after: '960', actor_id: '42', actor_email: 'historic@test.mx', occurred_at: '2026-08-25T10:00:00.000Z' }];
    const query = vi.fn().mockResolvedValue(rows);
    const repository = new DocumentSeriesActivityRepository({ query } as never);

    await expect(repository.findRecent(6)).resolves.toEqual(rows);
    expect(query).toHaveBeenCalledWith(expect.any(String), [6]);
    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain('FROM operacion.ajustes_series adjustment');
    expect(sql).toContain('JOIN operacion.series_documentales series ON series.serie_id = adjustment.serie_id');
    expect(sql).toContain('adjustment.siguiente_folio_anterior::text AS folio_before');
    expect(sql).toContain('adjustment.siguiente_folio_nuevo::text AS folio_after');
    expect(sql).toContain('ORDER BY adjustment.created_at DESC, adjustment.ajuste_id DESC');
    expect(sql).toContain('LIMIT $1');
  });

  it('resolves current display names for the given actor ids only', async () => {
    const query = vi.fn().mockResolvedValue([{ id: '42', display_name: 'Alejandro López' }]);
    const repository = new DocumentSeriesActivityRepository({ query } as never);

    const result = await repository.findActorDisplayNames(['42']);

    expect(result.get('42')).toBe('Alejandro López');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM security.users'), [['42']]);
  });

  it('skips the query entirely for an empty actor id list', async () => {
    const query = vi.fn();
    const repository = new DocumentSeriesActivityRepository({ query } as never);

    await expect(repository.findActorDisplayNames([])).resolves.toEqual(new Map());
    expect(query).not.toHaveBeenCalled();
  });
});
