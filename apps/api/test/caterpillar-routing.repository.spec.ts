import { describe, expect, it, vi } from 'vitest';
import { CaterpillarRoutingRepository } from '../src/automations/remisiones-caterpillar/caterpillar-routing.repository';

describe('CaterpillarRoutingRepository', () => {
  it('scopes the routing query to REMISIONES_CATERPILLAR, joins series and LEFT JOINs the client company', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const repository = new CaterpillarRoutingRepository({ query } as never);

    await repository.listRoutes();

    expect(query).toHaveBeenCalledTimes(1);
    const [sql] = query.mock.calls[0]!;
    expect(sql).toContain('FROM ops.automatizacion_series_proceso ruta');
    expect(sql).toContain("automatizacion.codigo = 'REMISIONES_CATERPILLAR'");
    expect(sql).toContain('JOIN operacion.series_documentales serie');
    expect(sql).toContain('LEFT JOIN core.empresas empresa');
    expect(sql).toContain('ORDER BY ruta.ruta_id');
    // Never derives routing by parsing operacion.series_documentales.codigo (Phase 12A.3 §B).
    expect(sql).not.toMatch(/codigo\s+LIKE|codigo\s+~/i);
  });

  it('returns the raw rows unmapped (presentation stays in the service)', async () => {
    const rows = [{ ruta_id: '1', llave_proceso: 'CATERPILLAR_P2|P2|', route_status: 'ACTIVA' }];
    const query = vi.fn().mockResolvedValue(rows);
    const repository = new CaterpillarRoutingRepository({ query } as never);
    await expect(repository.listRoutes()).resolves.toEqual(rows);
  });
});
