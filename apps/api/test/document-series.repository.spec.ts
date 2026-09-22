import { describe, expect, it, vi } from 'vitest';
import { DocumentSeriesRepository } from '../src/automations/document-series.repository';

function repositoryWithClient(query: ReturnType<typeof vi.fn>) {
  const client = { query, release: vi.fn() };
  return { repository: new DocumentSeriesRepository({ connect: vi.fn().mockResolvedValue(client) } as never), client };
}

function lockedSeriesRow(overrides: Partial<{ serie_id: string; siguiente_folio: string; folio_minimo_ajustable: string | null }> = {}) {
  return {
    rows: [{
      serie_id: '42', codigo: 'SERIES_TEST', nombre: 'Series', estatus: 'ACTIVO',
      siguiente_folio: '994', folio_minimo_ajustable: null,
      ...overrides
    }]
  };
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

  describe('adjustNextFolio — ownership + lock', () => {
    it('locks the series scoped to the requested automation via ops.automatizacion_series_proceso, never by parsing series codes', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
        .mockResolvedValueOnce(lockedSeriesRow())
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
      const { repository } = repositoryWithClient(query);
      await repository.adjustNextFolio('AUTO_TEST', 'SERIES_TEST', { expectedCurrentFolio: 994, nextFolio: 1000, reason: 'Ajuste' }, 'request-1', { userId: null, userEmail: null });
      const [lockSql, lockParams] = query.mock.calls[6]!;
      expect(lockSql).toContain('FROM operacion.series_documentales series');
      expect(lockSql).toContain('JOIN ops.automatizacion_series_proceso ruta ON ruta.serie_id = series.serie_id');
      expect(lockSql).toContain('JOIN ops.automatizaciones automation ON automation.automatizacion_id = ruta.automatizacion_id');
      expect(lockSql).toContain('WHERE series.codigo = $1');
      expect(lockSql).toContain('AND automation.codigo = $2');
      expect(lockSql).toContain('FOR UPDATE OF series');
      expect(lockParams).toEqual(['SERIES_TEST', 'AUTO_TEST']);
    });

    it('rejects an automation/series ownership mismatch as DOCUMENT_SERIES_NOT_FOUND, without writing anything', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
        .mockResolvedValueOnce({ rows: [] }) // the ownership join finds nothing for this automation/series pair
        .mockResolvedValueOnce(undefined);
      const { repository } = repositoryWithClient(query);
      await expect(repository.adjustNextFolio('REMISIONES_CATERPILLAR', 'REMISION_AUDI', { expectedCurrentFolio: 994, nextFolio: 1000, reason: 'Ajuste' }, 'request-2', { userId: null, userEmail: null }))
        .rejects.toMatchObject({ code: 'DOCUMENT_SERIES_NOT_FOUND' });
      expect(query).toHaveBeenLastCalledWith('ROLLBACK');
      expect(query.mock.calls.some((call) => String(call[0]).includes('UPDATE operacion.series_documentales'))).toBe(false);
    });
  });

  describe('adjustNextFolio — optimistic concurrency', () => {
    it('rejects a stale expectedCurrentFolio without writing anything (simulated concurrent n8n reservation)', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
        // the locked read shows the series has moved to 999 (e.g. n8n reserved folios) since the
        // admin's dialog last displayed 994 — expectedCurrentFolio=994 no longer matches.
        .mockResolvedValueOnce(lockedSeriesRow({ siguiente_folio: '999' }))
        .mockResolvedValueOnce(undefined);
      const { repository } = repositoryWithClient(query);
      await expect(repository.adjustNextFolio('AUTO_TEST', 'SERIES_TEST', { expectedCurrentFolio: 994, nextFolio: 1000, reason: 'Ajuste' }, 'request-3', { userId: null, userEmail: null }))
        .rejects.toMatchObject({ code: 'SERIES_FOLIO_STALE' });
      expect(query).toHaveBeenLastCalledWith('ROLLBACK');
      expect(query.mock.calls.some((call) => String(call[0]).includes('UPDATE operacion.series_documentales'))).toBe(false);
      expect(query.mock.calls.some((call) => String(call[0]).includes('INSERT INTO operacion.ajustes_series'))).toBe(false);
    });
  });

  describe('adjustNextFolio — forward', () => {
    it.each([[1000], [995]])('applies a forward adjustment to %i with no backward-history checks', async (nextFolio) => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
        .mockResolvedValueOnce(lockedSeriesRow())
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
      const { repository, client } = repositoryWithClient(query);
      await repository.adjustNextFolio('AUTO_TEST', 'SERIES_TEST', { expectedCurrentFolio: 994, nextFolio, reason: 'Corrección manual' }, 'request-4', { userId: null, userEmail: null });
      // No remission/reservation conflict queries at all for a forward move.
      expect(query.mock.calls.some((call) => String(call[0]).includes('FROM operacion.remisiones'))).toBe(false);
      expect(query.mock.calls.some((call) => String(call[0]).includes('FROM operacion.reservas_folios'))).toBe(false);
      expect(query.mock.calls[7]).toEqual([expect.stringContaining('UPDATE operacion.series_documentales'), [nextFolio, '42']]);
      expect(query.mock.calls[8]).toEqual([expect.stringContaining('INSERT INTO operacion.ajustes_series'), ['42', 994, nextFolio, 'Corrección manual', null, null]]);
      expect(query).toHaveBeenLastCalledWith('COMMIT');
      expect(client.release).toHaveBeenCalledOnce();
    });

    it('rejects a forward target below the configured floor without updating the series or inserting audit history', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
        .mockResolvedValueOnce(lockedSeriesRow({ siguiente_folio: '1', folio_minimo_ajustable: '778' }))
        .mockResolvedValueOnce(undefined);
      const { repository } = repositoryWithClient(query);

      await expect(repository.adjustNextFolio('AUTO_TEST', 'SERIES_TEST', { expectedCurrentFolio: 1, nextFolio: 100, reason: 'Ajuste' }, 'request-forward-floor-1', { userId: null, userEmail: null }))
        .rejects.toMatchObject({ code: 'SERIES_FOLIO_BELOW_FLOOR' });

      expect(query).toHaveBeenLastCalledWith('ROLLBACK');
      expect(query.mock.calls.some((call) => String(call[0]).includes('UPDATE operacion.series_documentales'))).toBe(false);
      expect(query.mock.calls.some((call) => String(call[0]).includes('INSERT INTO operacion.ajustes_series'))).toBe(false);
    });

    it.each([[778], [800]])('allows a forward target at or above configured floor 778: %i', async (nextFolio) => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
        .mockResolvedValueOnce(lockedSeriesRow({ siguiente_folio: '1', folio_minimo_ajustable: '778' }))
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
      const { repository } = repositoryWithClient(query);

      await repository.adjustNextFolio('AUTO_TEST', 'SERIES_TEST', { expectedCurrentFolio: 1, nextFolio, reason: 'Ajuste' }, 'request-forward-floor-2', { userId: null, userEmail: null });

      expect(query.mock.calls[7]).toEqual([expect.stringContaining('UPDATE operacion.series_documentales'), [nextFolio, '42']]);
      expect(query).toHaveBeenLastCalledWith('COMMIT');
    });

    it('allows a forward adjustment when no floor is configured', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
        .mockResolvedValueOnce(lockedSeriesRow({ siguiente_folio: '1', folio_minimo_ajustable: null }))
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
      const { repository } = repositoryWithClient(query);

      await repository.adjustNextFolio('AUTO_TEST', 'SERIES_TEST', { expectedCurrentFolio: 1, nextFolio: 100, reason: 'Ajuste' }, 'request-forward-floor-3', { userId: null, userEmail: null });

      expect(query.mock.calls[7]).toEqual([expect.stringContaining('UPDATE operacion.series_documentales'), [100, '42']]);
      expect(query).toHaveBeenLastCalledWith('COMMIT');
    });
  });

  describe('adjustNextFolio — unchanged', () => {
    it('rejects an unchanged folio after acquiring the lock', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
        .mockResolvedValueOnce(lockedSeriesRow())
        .mockResolvedValueOnce(undefined);
      const { repository } = repositoryWithClient(query);
      await expect(repository.adjustNextFolio('AUTO_TEST', 'SERIES_TEST', { expectedCurrentFolio: 994, nextFolio: 994, reason: 'Sin cambio' }, 'request-5', { userId: null, userEmail: null })).rejects.toMatchObject({ code: 'DOCUMENT_SERIES_FOLIO_UNCHANGED' });
      expect(query).toHaveBeenLastCalledWith('ROLLBACK');
      expect(query.mock.calls.some((call) => String(call[0]).includes('UPDATE operacion.series_documentales'))).toBe(false);
    });
  });

  describe('adjustNextFolio — backward safety', () => {
    it('rejects a backward request missing the filesystem acknowledgement, before any DB safety query', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
        .mockResolvedValueOnce(lockedSeriesRow({ folio_minimo_ajustable: '900' }))
        .mockResolvedValueOnce(undefined);
      const { repository } = repositoryWithClient(query);
      await expect(repository.adjustNextFolio('AUTO_TEST', 'SERIES_TEST', { expectedCurrentFolio: 994, nextFolio: 950, reason: 'Corrección' }, 'request-6', { userId: null, userEmail: null }))
        .rejects.toMatchObject({ code: 'BACKWARD_ACKNOWLEDGEMENT_REQUIRED' });
      expect(query.mock.calls.some((call) => String(call[0]).includes('FROM operacion.remisiones'))).toBe(false);
      expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    });

    it('rejects a backward request when no floor is configured (folio_minimo_ajustable IS NULL) — fails closed, never falls back to MIN(history)', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
        .mockResolvedValueOnce(lockedSeriesRow({ folio_minimo_ajustable: null }))
        .mockResolvedValueOnce(undefined);
      const { repository } = repositoryWithClient(query);
      await expect(repository.adjustNextFolio('AUTO_TEST', 'SERIES_TEST', { expectedCurrentFolio: 994, nextFolio: 950, reason: 'Corrección', backwardFilesystemAcknowledged: true }, 'request-7', { userId: null, userEmail: null }))
        .rejects.toMatchObject({ code: 'SERIES_FOLIO_FLOOR_UNCONFIGURED' });
      expect(query.mock.calls.some((call) => String(call[0]).includes('FROM operacion.remisiones'))).toBe(false);
      expect(query.mock.calls.some((call) => String(call[0]).includes('MIN('))).toBe(false);
    });

    it('rejects a target below the configured floor', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
        .mockResolvedValueOnce(lockedSeriesRow({ folio_minimo_ajustable: '119' }))
        .mockResolvedValueOnce(undefined);
      const { repository } = repositoryWithClient(query);
      await expect(repository.adjustNextFolio('AUTO_TEST', 'SERIES_TEST', { expectedCurrentFolio: 994, nextFolio: 100, reason: 'Corrección', backwardFilesystemAcknowledged: true }, 'request-8', { userId: null, userEmail: null }))
        .rejects.toMatchObject({ code: 'SERIES_FOLIO_BELOW_FLOOR' });
      expect(query.mock.calls.some((call) => String(call[0]).includes('FROM operacion.remisiones'))).toBe(false);
      expect(query.mock.calls.some((call) => String(call[0]).includes('UPDATE operacion.series_documentales'))).toBe(false);
      expect(query.mock.calls.some((call) => String(call[0]).includes('INSERT INTO operacion.ajustes_series'))).toBe(false);
    });

    it('allows a backward target exactly at the floor when the range is otherwise clean', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
        .mockResolvedValueOnce(lockedSeriesRow({ siguiente_folio: '124', folio_minimo_ajustable: '119' }))
        .mockResolvedValueOnce({ rows: [] }) // no remission conflict
        .mockResolvedValueOnce({ rows: [] }) // no reservation conflict
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
      const { repository } = repositoryWithClient(query);
      await repository.adjustNextFolio('AUTO_TEST', 'SERIES_TEST', { expectedCurrentFolio: 124, nextFolio: 119, reason: 'Corrección excepcional', backwardFilesystemAcknowledged: true }, 'request-9', { userId: '5', userEmail: 'admin@daubert.mx' });
      const [remissionSql, remissionParams] = query.mock.calls[7]!;
      expect(remissionSql).toContain("estatus <> 'CANCELADA'");
      expect(remissionParams).toEqual(['42', 119, 123]);
      const [reservationSql, reservationParams] = query.mock.calls[8]!;
      expect(reservationSql).not.toMatch(/ABANDONADA/); // no status exclusion at all — see next test
      expect(reservationParams).toEqual(['42', 119, 123]);
      expect(query).toHaveBeenLastCalledWith('COMMIT');
    });

    it('rejects when a non-cancelled remisión exists in the reused range', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
        .mockResolvedValueOnce(lockedSeriesRow({ siguiente_folio: '124', folio_minimo_ajustable: '119' }))
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // remission conflict found
        .mockResolvedValueOnce(undefined);
      const { repository } = repositoryWithClient(query);
      await expect(repository.adjustNextFolio('AUTO_TEST', 'SERIES_TEST', { expectedCurrentFolio: 124, nextFolio: 119, reason: 'Corrección', backwardFilesystemAcknowledged: true }, 'request-10', { userId: null, userEmail: null }))
        .rejects.toMatchObject({ code: 'SERIES_FOLIO_REMISSION_CONFLICT' });
      expect(query.mock.calls.some((call) => String(call[0]).includes('FROM operacion.reservas_folios'))).toBe(false);
      expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    });

    it('does not treat a CANCELADA remisión alone as a conflict (query excludes it explicitly)', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
        .mockResolvedValueOnce(lockedSeriesRow({ siguiente_folio: '124', folio_minimo_ajustable: '119' }))
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
      const { repository } = repositoryWithClient(query);
      await repository.adjustNextFolio('AUTO_TEST', 'SERIES_TEST', { expectedCurrentFolio: 124, nextFolio: 119, reason: 'Corrección', backwardFilesystemAcknowledged: true }, 'request-11', { userId: null, userEmail: null });
      const [remissionSql] = query.mock.calls[7]!;
      expect(remissionSql).toContain("estatus <> 'CANCELADA'");
    });

    it.each(['RESERVADA', 'APLICADA', 'ABANDONADA'])('rejects when a %s reservation overlaps the reused range — ABANDONADA is never excluded', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
        .mockResolvedValueOnce(lockedSeriesRow({ siguiente_folio: '124', folio_minimo_ajustable: '119' }))
        .mockResolvedValueOnce({ rows: [] }) // no remission conflict
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // reservation conflict found, regardless of status
        .mockResolvedValueOnce(undefined);
      const { repository } = repositoryWithClient(query);
      await expect(repository.adjustNextFolio('AUTO_TEST', 'SERIES_TEST', { expectedCurrentFolio: 124, nextFolio: 119, reason: 'Corrección', backwardFilesystemAcknowledged: true }, 'request-12', { userId: null, userEmail: null }))
        .rejects.toMatchObject({ code: 'SERIES_FOLIO_RESERVATION_CONFLICT' });
      const [reservationSql] = query.mock.calls[8]!;
      expect(reservationSql).not.toMatch(/estatus\s*<>\s*'ABANDONADA'/);
      expect(reservationSql).not.toMatch(/estatus\s*=\s*'RESERVADA'/);
      expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    });

    it('never issues an UPDATE/DELETE against remisiones or reservas_folios', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
        .mockResolvedValueOnce(lockedSeriesRow({ siguiente_folio: '124', folio_minimo_ajustable: '119' }))
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
      const { repository } = repositoryWithClient(query);
      await repository.adjustNextFolio('AUTO_TEST', 'SERIES_TEST', { expectedCurrentFolio: 124, nextFolio: 119, reason: 'Corrección', backwardFilesystemAcknowledged: true }, 'request-13', { userId: null, userEmail: null });
      const mutatesHistory = query.mock.calls.some((call) => {
        const sql = String(call[0]);
        return (sql.includes('UPDATE operacion.remisiones') || sql.includes('DELETE FROM operacion.remisiones') || sql.includes('UPDATE operacion.reservas_folios') || sql.includes('DELETE FROM operacion.reservas_folios'));
      });
      expect(mutatesHistory).toBe(false);
    });
  });

  it('rolls back the sequence update when history insertion fails', async () => {
    const failure = new Error('history failed');
    const query = vi.fn()
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ exists: 1 }] })
      .mockResolvedValueOnce(lockedSeriesRow())
      .mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined);
    const { repository } = repositoryWithClient(query);
    await expect(repository.adjustNextFolio('AUTO_TEST', 'SERIES_TEST', { expectedCurrentFolio: 994, nextFolio: 1000, reason: 'Corrección' }, 'request-14', { userId: null, userEmail: null })).rejects.toBe(failure);
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(query).not.toHaveBeenCalledWith('COMMIT');
  });
});
