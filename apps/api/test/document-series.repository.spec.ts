import { describe, expect, it, vi } from 'vitest';
import { DocumentSeriesRepository } from '../src/automations/document-series.repository';

function repositoryWithClient(query: ReturnType<typeof vi.fn>) {
  const client = { query, release: vi.fn() };
  return { repository: new DocumentSeriesRepository({ connect: vi.fn().mockResolvedValue(client) } as never), client };
}

describe('DocumentSeriesRepository', () => {
  it('reads configuration by stable codes and orders history newest-first', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ codigo: 'AUTO_TEST', nombre: 'Automation', estatus: 'ACTIVO' }])
      .mockResolvedValueOnce([{ serie_id: '9007199254740993', codigo: 'SERIES_TEST', nombre: 'Series', siguiente_folio: '994', estatus: 'ACTIVO' }])
      .mockResolvedValueOnce([{ siguiente_folio_anterior: '995', siguiente_folio_nuevo: '994', motivo: 'Correction', usuario_email: null, created_at: '2026-08-27T12:00:00.000Z' }]);
    const repository = new DocumentSeriesRepository({ query } as never);
    await expect(repository.findConfiguration('AUTO_TEST', 'SERIES_TEST')).resolves.toMatchObject({
      series: { serie_id: '9007199254740993', siguiente_folio: 994 },
      adjustments: [{ siguiente_folio_anterior: 995, siguiente_folio_nuevo: 994 }]
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE codigo = $1'), ['AUTO_TEST']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY adjustment.created_at DESC, adjustment.ajuste_id DESC'), ['SERIES_TEST']);
  });

  it.each([[1000], [993]])('atomically changes the next folio to %i under a row lock', async (nextFolio) => {
    const query = vi.fn()
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
      .mockResolvedValueOnce({ rows: [{ serie_id: '42', codigo: 'SERIES_TEST', nombre: 'Series', siguiente_folio: '994', estatus: 'ACTIVO' }] })
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    const { repository, client } = repositoryWithClient(query);
    await repository.adjustNextFolio('AUTO_TEST', 'SERIES_TEST', nextFolio, 'Corrección manual', 'request-1');
    expect(query.mock.calls[4]?.[0]).toContain('FOR UPDATE');
    expect(query.mock.calls[5]).toEqual([expect.stringContaining('UPDATE operacion.series_documentales'), [nextFolio, '42']]);
    expect(query.mock.calls[6]).toEqual([expect.stringContaining('INSERT INTO operacion.ajustes_series'), ['42', 994, nextFolio, 'Corrección manual', null, null]]);
    expect(query).toHaveBeenLastCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rejects an unchanged folio after acquiring the lock', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
      .mockResolvedValueOnce({ rows: [{ serie_id: '42', siguiente_folio: '994' }] })
      .mockResolvedValueOnce(undefined);
    const { repository } = repositoryWithClient(query);
    await expect(repository.adjustNextFolio('AUTO_TEST', 'SERIES_TEST', 994, 'Sin cambio', 'request-2')).rejects.toMatchObject({ code: 'DOCUMENT_SERIES_FOLIO_UNCHANGED' });
    expect(query.mock.calls[4]?.[0]).toContain('FOR UPDATE');
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(query.mock.calls.some((call) => String(call[0]).includes('UPDATE operacion.series_documentales'))).toBe(false);
  });

  it('rolls back the sequence update when history insertion fails', async () => {
    const failure = new Error('history failed');
    const query = vi.fn()
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
      .mockResolvedValueOnce({ rows: [{ serie_id: '42', siguiente_folio: '994' }] })
      .mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined);
    const { repository } = repositoryWithClient(query);
    await expect(repository.adjustNextFolio('AUTO_TEST', 'SERIES_TEST', 993, 'Corrección', 'request-3')).rejects.toBe(failure);
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(query).not.toHaveBeenCalledWith('COMMIT');
  });
});
