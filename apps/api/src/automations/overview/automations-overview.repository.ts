import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../../database/database.service';

export interface AudiOverviewRow extends QueryResultRow {
  lifecycle_status: string;
  execution_state: string | null;
  occurred_at: Date | string | null;
}

@Injectable()
export class AutomationsOverviewRepository {
  constructor(private readonly database: DatabaseService) {}

  // The newest ops.ejecuciones_automatizacion row for REMISIONES_AUDI, if any. This table's
  // documento_origen_id column is NOT NULL (FK to core.documentos) — a row can only exist when a
  // source document was actually found, so it structurally cannot represent a no-work polling
  // cycle. This query is therefore a valid source for "last processing" only, never "last check"
  // (see automations-overview.service.ts).
  async findAudiOverview(): Promise<AudiOverviewRow | null> {
    const [row] = await this.database.query<AudiOverviewRow>(`
      SELECT
        automation.estatus AS lifecycle_status,
        execution.estado AS execution_state,
        COALESCE(execution.finalizada_en, execution.iniciada_en) AS occurred_at
      FROM ops.automatizaciones automation
      LEFT JOIN LATERAL (
        SELECT estado, finalizada_en, iniciada_en
        FROM ops.ejecuciones_automatizacion e
        WHERE e.automatizacion_id = automation.automatizacion_id
        ORDER BY e.ejecucion_id DESC
        LIMIT 1
      ) execution ON TRUE
      WHERE automation.codigo = 'REMISIONES_AUDI'`);
    return row ?? null;
  }

  // Phase 12A.3 §A: identical shape/query to findAudiOverview above (AudiOverviewRow is reused
  // as-is — the row shape is generic to any ops.automatizaciones/ops.ejecuciones_automatizacion
  // pair despite its name), scoped to REMISIONES_CATERPILLAR instead. There may be zero Caterpillar
  // executions in production (confirmed true today) — the LEFT JOIN LATERAL already makes that a
  // normal null `execution`, not an error, exactly as it already does for a newly-onboarded automation.
  async findCaterpillarOverview(): Promise<AudiOverviewRow | null> {
    const [row] = await this.database.query<AudiOverviewRow>(`
      SELECT
        automation.estatus AS lifecycle_status,
        execution.estado AS execution_state,
        COALESCE(execution.finalizada_en, execution.iniciada_en) AS occurred_at
      FROM ops.automatizaciones automation
      LEFT JOIN LATERAL (
        SELECT estado, finalizada_en, iniciada_en
        FROM ops.ejecuciones_automatizacion e
        WHERE e.automatizacion_id = automation.automatizacion_id
        ORDER BY e.ejecucion_id DESC
        LIMIT 1
      ) execution ON TRUE
      WHERE automation.codigo = 'REMISIONES_CATERPILLAR'`);
    return row ?? null;
  }
}
