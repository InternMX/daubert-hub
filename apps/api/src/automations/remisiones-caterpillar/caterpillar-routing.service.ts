import { Injectable } from '@nestjs/common';
import { caterpillarProcessLabel } from './caterpillar-process-labels';
import { CaterpillarRoutingRepository, type CaterpillarRouteRow } from './caterpillar-routing.repository';

export type CaterpillarStatus = 'ACTIVE' | 'INACTIVE';

// ACTIVA/INACTIVA -> ACTIVE/INACTIVE, the same two-value translation already used for
// ops.automatizaciones.estatus (AUDI_LIFECYCLE_MAP in automations-overview.service.ts) — applied
// here independently to route status and series status, which are two distinct DB-backed concepts
// and must never be collapsed into one another or into a single derived "active" flag (Phase
// 12A.3: nine routes are ACTIVA, only three of their series are ACTIVA).
function mapStatus(estatus: string): CaterpillarStatus {
  return estatus === 'ACTIVA' ? 'ACTIVE' : 'INACTIVE';
}

export interface CaterpillarProcessRoute {
  routeId: string;
  // Raw llave_proceso, always present verbatim alongside the resolved label — an unrecognized key
  // never gets dropped or crashes the response (Phase 12A.3 §B).
  processKey: string;
  processLabel: string;
  routeStatus: CaterpillarStatus;
  seriesId: string;
  seriesCode: string;
  seriesStatus: CaterpillarStatus;
  nextFolio: number;
  clientCompanyId: string;
  clientCompanyName: string | null;
}

export interface ListCaterpillarSeriesResponse {
  data: CaterpillarProcessRoute[];
}

function mapRoute(row: CaterpillarRouteRow): CaterpillarProcessRoute {
  return {
    routeId: row.ruta_id,
    processKey: row.llave_proceso,
    processLabel: caterpillarProcessLabel(row.llave_proceso),
    routeStatus: mapStatus(row.route_status),
    seriesId: row.serie_id,
    seriesCode: row.serie_codigo,
    seriesStatus: mapStatus(row.serie_status),
    nextFolio: Number(row.siguiente_folio),
    clientCompanyId: row.empresa_cliente_id,
    clientCompanyName: row.empresa_nombre
  };
}

// Used by CaterpillarExecutionsService to attach a process label to an execution only when it can
// be derived unambiguously, without re-querying the routing table per execution row. An
// execution's folio reservations point at a serie_id, but Torreón's two routes (TORREON and
// TORREON PLANTA_2) share one serie_id (9) — so a serie_id alone does not always identify a single
// route. Returns null (never a guess) unless the execution reserved folios in exactly one series
// AND that series maps to exactly one route.
export function resolveCaterpillarProcessLabel(routes: readonly CaterpillarProcessRoute[], serieIds: readonly string[]): string | null {
  if (serieIds.length !== 1) return null;
  const [serieId] = serieIds;
  const matches = routes.filter((route) => route.seriesId === serieId);
  return matches.length === 1 ? matches[0]!.processLabel : null;
}

@Injectable()
export class CaterpillarRoutingService {
  constructor(private readonly repository: CaterpillarRoutingRepository) {}

  async listRoutes(): Promise<CaterpillarProcessRoute[]> {
    const rows = await this.repository.listRoutes();
    return rows.map((row) => mapRoute(row));
  }

  async listSeries(): Promise<ListCaterpillarSeriesResponse> {
    return { data: await this.listRoutes() };
  }
}
