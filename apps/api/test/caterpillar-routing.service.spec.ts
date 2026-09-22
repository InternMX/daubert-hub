import { describe, expect, it, vi } from 'vitest';
import type { CaterpillarRouteRow } from '../src/automations/remisiones-caterpillar/caterpillar-routing.repository';
import { CaterpillarRoutingService, resolveCaterpillarProcessLabel, type CaterpillarProcessRoute } from '../src/automations/remisiones-caterpillar/caterpillar-routing.service';

// Mirrors the real production routing rows confirmed in Phase 12A.3 discovery.
function route(overrides: Partial<CaterpillarRouteRow> = {}): CaterpillarRouteRow {
  return {
    ruta_id: '1',
    llave_proceso: 'CATERPILLAR_P2|P2|',
    route_status: 'ACTIVA',
    serie_id: '2',
    serie_codigo: 'REMISION_CAT_P2',
    serie_status: 'ACTIVA',
    siguiente_folio: '85',
    empresa_cliente_id: '122',
    empresa_nombre: 'CATERPILLAR',
    ...overrides
  };
}

const TORREON_ROUTES: CaterpillarRouteRow[] = [
  route({ ruta_id: '9', llave_proceso: 'CAT_TORREON|TORREON|', serie_id: '9', serie_codigo: 'REMISION_CAT_TORREON', serie_status: 'INACTIVA', siguiente_folio: '778' }),
  route({ ruta_id: '8', llave_proceso: 'CAT_TORREON|TORREON|PLANTA_2', serie_id: '9', serie_codigo: 'REMISION_CAT_TORREON', serie_status: 'INACTIVA', siguiente_folio: '778' })
];

describe('CaterpillarRoutingService', () => {
  describe('listSeries', () => {
    it('maps ACTIVA/INACTIVA independently for route status and series status', async () => {
      const repository = { listRoutes: vi.fn().mockResolvedValue([route({ route_status: 'ACTIVA', serie_status: 'INACTIVA' })]) };
      const service = new CaterpillarRoutingService(repository as never);
      const { data } = await service.listSeries();
      expect(data[0]).toMatchObject({ routeStatus: 'ACTIVE', seriesStatus: 'INACTIVE' });
    });

    it('resolves a known llave_proceso to its Spanish label while keeping the raw key', async () => {
      const repository = { listRoutes: vi.fn().mockResolvedValue([route({ llave_proceso: 'CAT_NUEVO_LAREDO|NUEVO_LAREDO|FINSA_1' })]) };
      const service = new CaterpillarRoutingService(repository as never);
      const { data } = await service.listSeries();
      expect(data[0]).toMatchObject({ processKey: 'CAT_NUEVO_LAREDO|NUEVO_LAREDO|FINSA_1', processLabel: 'Nuevo Laredo FINSA 1' });
    });

    it('never drops or crashes on an unknown llave_proceso — falls back to displaying the raw key', async () => {
      const repository = { listRoutes: vi.fn().mockResolvedValue([route({ llave_proceso: 'CAT_FUTURE_PLANT|UNKNOWN|' })]) };
      const service = new CaterpillarRoutingService(repository as never);
      const { data } = await service.listSeries();
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({ processKey: 'CAT_FUTURE_PLANT|UNKNOWN|', processLabel: 'CAT_FUTURE_PLANT|UNKNOWN|' });
    });

    it('keeps Torreón and Torreón Planta 2 as two distinct process rows despite sharing one serie_id', async () => {
      const repository = { listRoutes: vi.fn().mockResolvedValue(TORREON_ROUTES) };
      const service = new CaterpillarRoutingService(repository as never);
      const { data } = await service.listSeries();
      expect(data).toHaveLength(2);
      expect(data.map((item) => item.processLabel).sort()).toEqual(['Torreón', 'Torreón Planta 2']);
      expect(data.every((item) => item.seriesId === '9')).toBe(true);
    });

    it('parses siguiente_folio to a number and passes through the client company id/name', async () => {
      const repository = { listRoutes: vi.fn().mockResolvedValue([route({ siguiente_folio: '119', empresa_cliente_id: '122', empresa_nombre: 'CATERPILLAR' })]) };
      const service = new CaterpillarRoutingService(repository as never);
      const { data } = await service.listSeries();
      expect(data[0]).toMatchObject({ nextFolio: 119, clientCompanyId: '122', clientCompanyName: 'CATERPILLAR' });
    });

    it('keeps a route visible with a null client name when the company cannot be resolved', async () => {
      const repository = { listRoutes: vi.fn().mockResolvedValue([route({ empresa_nombre: null })]) };
      const service = new CaterpillarRoutingService(repository as never);
      const { data } = await service.listSeries();
      expect(data[0]?.clientCompanyName).toBeNull();
    });

    it('returns all nine configured routes unfiltered, regardless of route/series status', async () => {
      const nineRoutes = [...Array(9)].map((_, index) => route({ ruta_id: String(index + 1) }));
      const repository = { listRoutes: vi.fn().mockResolvedValue(nineRoutes) };
      const service = new CaterpillarRoutingService(repository as never);
      const { data } = await service.listSeries();
      expect(data).toHaveLength(9);
    });
  });

  describe('resolveCaterpillarProcessLabel', () => {
    const p2: CaterpillarProcessRoute = {
      routeId: '1', processKey: 'CATERPILLAR_P2|P2|', processLabel: 'P2', routeStatus: 'ACTIVE',
      seriesId: '2', seriesCode: 'REMISION_CAT_P2', seriesStatus: 'ACTIVE', nextFolio: 85,
      clientCompanyId: '122', clientCompanyName: 'CATERPILLAR'
    };
    const torreon: CaterpillarProcessRoute = {
      routeId: '9', processKey: 'CAT_TORREON|TORREON|', processLabel: 'Torreón', routeStatus: 'ACTIVE',
      seriesId: '9', seriesCode: 'REMISION_CAT_TORREON', seriesStatus: 'INACTIVE', nextFolio: 778,
      clientCompanyId: '122', clientCompanyName: 'CATERPILLAR'
    };
    const torreonPlanta2: CaterpillarProcessRoute = {
      ...torreon, routeId: '8', processKey: 'CAT_TORREON|TORREON|PLANTA_2', processLabel: 'Torreón Planta 2'
    };
    const routes = [p2, torreon, torreonPlanta2];

    it('resolves a single unambiguous route from its one reserved series', () => {
      expect(resolveCaterpillarProcessLabel(routes, ['2'])).toBe('P2');
    });

    it('returns null when the execution reserved zero series', () => {
      expect(resolveCaterpillarProcessLabel(routes, [])).toBeNull();
    });

    it('returns null when the execution reserved more than one series', () => {
      expect(resolveCaterpillarProcessLabel(routes, ['2', '9'])).toBeNull();
    });

    it('returns null (never a guess) when the reserved series is shared by two routes (Torreón)', () => {
      expect(resolveCaterpillarProcessLabel(routes, ['9'])).toBeNull();
    });

    it('returns null when the reserved series matches no known route', () => {
      expect(resolveCaterpillarProcessLabel(routes, ['999'])).toBeNull();
    });
  });
});
