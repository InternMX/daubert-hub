import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../../database/database.service';

export interface CaterpillarRouteRow extends QueryResultRow {
  ruta_id: string;
  llave_proceso: string;
  route_status: string;
  serie_id: string;
  serie_codigo: string;
  serie_status: string;
  siguiente_folio: string;
  empresa_cliente_id: string;
  empresa_nombre: string | null;
}

// Phase 12A.3 §B: the authority for process/plant -> series routing is exclusively
// ops.automatizacion_series_proceso, joined to operacion.series_documentales for the series'
// own status/siguiente_folio and LEFT JOINed to core.empresas for the client display name (LEFT,
// not INNER — a route row must stay visible even if the client company name can't resolve,
// same convention as PaymentNotificationsRepository.findResultsByExecutionId). Never derives
// routing by parsing operacion.series_documentales.codigo (e.g. 'REMISION_CAT_%') — llave_proceso
// and the FK join are the only routing signal used.
@Injectable()
export class CaterpillarRoutingRepository {
  constructor(private readonly database: DatabaseService) {}

  // Ordered by ruta_id (stable PK order) — this is a small, mostly-static configuration list, not
  // an activity feed, so there is no "newest first" concept to order by.
  async listRoutes(): Promise<CaterpillarRouteRow[]> {
    return this.database.query<CaterpillarRouteRow>(`
      SELECT
        ruta.ruta_id::text AS ruta_id,
        ruta.llave_proceso AS llave_proceso,
        ruta.estatus AS route_status,
        serie.serie_id::text AS serie_id,
        serie.codigo AS serie_codigo,
        serie.estatus AS serie_status,
        serie.siguiente_folio::text AS siguiente_folio,
        ruta.empresa_cliente_id::text AS empresa_cliente_id,
        empresa.nombre_comercial AS empresa_nombre
      FROM ops.automatizacion_series_proceso ruta
      JOIN ops.automatizaciones automatizacion
        ON automatizacion.automatizacion_id = ruta.automatizacion_id
       AND automatizacion.codigo = 'REMISIONES_CATERPILLAR'
      JOIN operacion.series_documentales serie
        ON serie.serie_id = ruta.serie_id
      LEFT JOIN core.empresas empresa
        ON empresa.empresa_id = ruta.empresa_cliente_id
      ORDER BY ruta.ruta_id`);
  }
}
