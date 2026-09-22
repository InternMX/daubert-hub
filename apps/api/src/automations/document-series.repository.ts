import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';

export interface AutomationRow extends QueryResultRow {
  codigo: string;
  nombre: string;
  estatus: string;
}

export interface DocumentSeriesRow extends QueryResultRow {
  serie_id: string;
  codigo: string;
  nombre: string;
  siguiente_folio: number;
  estatus: string;
  // Phase 12B.2: the explicit historical/cutover safety floor for every manual adjustment. null
  // means forward adjustments are allowed while backward adjustments fail closed. Never inferred from
  // MIN(remisiones.folio)/MIN(reservas_folios.folio_inicial) — see DocumentSeriesRepository.adjustNextFolio.
  folioMinimoAjustable: number | null;
}

export interface SeriesAdjustmentRow extends QueryResultRow {
  siguiente_folio_anterior: number;
  siguiente_folio_nuevo: number;
  motivo: string;
  usuario_email: string | null;
  created_at: Date | string;
}

interface RawDocumentSeriesRow extends QueryResultRow {
  serie_id: string;
  codigo: string;
  nombre: string;
  siguiente_folio: string;
  estatus: string;
}

interface RawLockedSeriesRow extends QueryResultRow {
  serie_id: string;
  codigo: string;
  nombre: string;
  siguiente_folio: string;
  estatus: string;
  folio_minimo_ajustable: string | null;
}

interface RawSeriesAdjustmentRow extends QueryResultRow {
  siguiente_folio_anterior: string;
  siguiente_folio_nuevo: string;
  motivo: string;
  usuario_email: string | null;
  created_at: Date | string;
}

export interface DocumentSeriesConfiguration {
  automation: AutomationRow;
  series: Omit<DocumentSeriesRow, 'folioMinimoAjustable'>;
  adjustments: SeriesAdjustmentRow[];
}

interface AuditUser {
  userId?: string | null;
  userEmail?: string | null;
}

// Phase 12B.2 §E: the caller-asserted current value (re-validated under the row lock —
// DOCUMENT_SERIES_FOLIO_STALE if it no longer matches) and the operational filesystem
// acknowledgement, required only for a backward request (nextFolio < expectedCurrentFolio).
export interface AdjustNextFolioInput {
  expectedCurrentFolio: number;
  nextFolio: number;
  reason: string;
  backwardFilesystemAcknowledged?: boolean;
}

@Injectable()
export class DocumentSeriesRepository {
  constructor(private readonly database: DatabaseService) {}

  async findConfiguration(automationCode: string, seriesCode: string): Promise<DocumentSeriesConfiguration | null> {
    const [automations, series, adjustments] = await Promise.all([
      this.database.query<AutomationRow>(`
        SELECT codigo, nombre, estatus
        FROM ops.automatizaciones
        WHERE codigo = $1`, [automationCode]),
      this.database.query<RawDocumentSeriesRow>(`
        SELECT serie_id::text, codigo, nombre, siguiente_folio, estatus
        FROM operacion.series_documentales
        WHERE codigo = $1`, [seriesCode]),
      this.database.query<RawSeriesAdjustmentRow>(`
        SELECT adjustment.siguiente_folio_anterior, adjustment.siguiente_folio_nuevo,
          adjustment.motivo, adjustment.usuario_email, adjustment.created_at
        FROM operacion.ajustes_series adjustment
        JOIN operacion.series_documentales series ON series.serie_id = adjustment.serie_id
        WHERE series.codigo = $1
        ORDER BY adjustment.created_at DESC, adjustment.ajuste_id DESC`, [seriesCode])
    ]);
    if (!automations[0] || !series[0]) return null;
    return {
      automation: automations[0],
      series: this.normalizeSeries(series[0]),
      adjustments: adjustments.map((adjustment) => this.normalizeAdjustment(adjustment))
    };
  }

  // Phase 12B.2: hardened for BOTH Audi and Caterpillar (they share this one write path —
  // Phase 12B.1 §16). Adds, inside the existing transaction/row-lock:
  //   1. automation<->series OWNERSHIP validation via ops.automatizacion_series_proceso (§D) —
  //      never by parsing seriesCode strings. A mismatched automationCode/seriesCode pair (e.g.
  //      REMISIONES_CATERPILLAR + an Audi-only series) resolves to the same "not found" the
  //      repository already reported for a genuinely unknown series.
  //   2. OPTIMISTIC CONCURRENCY: the caller's expectedCurrentFolio is compared to the value read
  //      under FOR UPDATE — a stale read (e.g. n8n reserved folios between the admin opening the
  //      dialog and submitting) is rejected before anything is written.
  //   3. CONFIGURED FLOOR: every manual target, regardless of direction, must be at or above
  //      folio_minimo_ajustable when configured.
  //   4. BACKWARD SAFETY: nextFolio < current requires backwardFilesystemAcknowledged=true (an
  //      operational acknowledgement only — never trusted as a DB-safety mechanism), a configured
  //      floor, and no conflicting non-cancelled remisión or ANY reservas_folios row (RESERVADA,
  //      APLICADA, or ABANDONADA — abandoned folios are deliberately never silently recycled by
  //      this action) overlapping the reused range [nextFolio, current-1].
  // Never UPDATEs/DELETEs remisiones or reservas_folios, never touches the filesystem.
  async adjustNextFolio(automationCode: string, seriesCode: string, input: AdjustNextFolioInput, requestId: string, user: AuditUser = {}): Promise<void> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await this.setAuditContext(client, requestId, user);
      await this.assertAutomationExists(client, automationCode);
      const series = await this.lockOwnedSeries(client, automationCode, seriesCode);
      if (!series) throw Object.assign(new Error('DOCUMENT_SERIES_NOT_FOUND'), { code: 'DOCUMENT_SERIES_NOT_FOUND' });

      if (series.siguiente_folio !== input.expectedCurrentFolio) {
        throw Object.assign(new Error('SERIES_FOLIO_STALE'), { code: 'SERIES_FOLIO_STALE' });
      }
      if (series.siguiente_folio === input.nextFolio) {
        throw Object.assign(new Error('DOCUMENT_SERIES_FOLIO_UNCHANGED'), { code: 'DOCUMENT_SERIES_FOLIO_UNCHANGED' });
      }
      if (series.folioMinimoAjustable !== null && input.nextFolio < series.folioMinimoAjustable) {
        throw Object.assign(new Error('SERIES_FOLIO_BELOW_FLOOR'), { code: 'SERIES_FOLIO_BELOW_FLOOR' });
      }

      if (input.nextFolio < series.siguiente_folio) {
        await this.assertBackwardAdjustmentSafe(client, series, input);
      }

      await client.query(`
        UPDATE operacion.series_documentales
        SET siguiente_folio = $1
        WHERE serie_id = $2`, [input.nextFolio, series.serie_id]);
      await client.query(`
        INSERT INTO operacion.ajustes_series
          (serie_id, siguiente_folio_anterior, siguiente_folio_nuevo, motivo, usuario_id, usuario_email)
        VALUES ($1, $2, $3, $4, $5, $6)`, [series.serie_id, series.siguiente_folio, input.nextFolio, input.reason, user.userId ?? null, user.userEmail ?? null]);
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the original database error. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  // operacion.series_documentales/ajustes_series carry no generic audit
  // trigger today (folio-change identity is instead recorded directly on
  // ajustes_series.usuario_id/usuario_email below), but app.user_id/
  // app.user_email are still set here for consistency with every other
  // repository and in case a generic trigger is ever attached later.
  private async setAuditContext(client: PoolClient, requestId: string, identity: AuditUser): Promise<void> {
    await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']);
    await client.query("SELECT set_config('app.request_id', $1, true)", [requestId]);
    await client.query("SELECT set_config('app.user_id', COALESCE($1, ''), true)", [identity.userId ?? null]);
    await client.query("SELECT set_config('app.user_email', COALESCE($1, ''), true)", [identity.userEmail ?? null]);
  }

  private async assertAutomationExists(client: PoolClient, code: string): Promise<void> {
    const result = await client.query('SELECT 1 FROM ops.automatizaciones WHERE codigo = $1', [code]);
    if (!result.rows[0]) throw Object.assign(new Error('AUTOMATION_NOT_FOUND'), { code: 'AUTOMATION_NOT_FOUND' });
  }

  // Phase 12B.2 §D/§G: ownership (does this series genuinely belong to this automation, via the
  // one authoritative ops.automatizacion_series_proceso mapping — Audi included, see migration
  // 20260922_004) and the row lock happen in the SAME query. `FOR UPDATE OF series` scopes the
  // lock to only the series_documentales row — daubert_hub_app has UPDATE there but only SELECT on
  // automatizacion_series_proceso/automatizaciones, and an unscoped FOR UPDATE would try (and be
  // denied) to lock those joined rows too.
  private async lockOwnedSeries(client: PoolClient, automationCode: string, seriesCode: string): Promise<DocumentSeriesRow | null> {
    const result = await client.query<RawLockedSeriesRow>(`
      SELECT series.serie_id::text, series.codigo, series.nombre, series.siguiente_folio, series.estatus,
        series.folio_minimo_ajustable::text
      FROM operacion.series_documentales series
      JOIN ops.automatizacion_series_proceso ruta ON ruta.serie_id = series.serie_id
      JOIN ops.automatizaciones automation ON automation.automatizacion_id = ruta.automatizacion_id
      WHERE series.codigo = $1
        AND automation.codigo = $2
      FOR UPDATE OF series`, [seriesCode, automationCode]);
    return result.rows[0] ? this.normalizeLockedSeries(result.rows[0]) : null;
  }

  // Phase 12B.2 §I: never inferred from MIN(remisiones.folio)/MIN(reservas_folios.folio_inicial —
  // Phase 12B.1's original proposal was explicitly corrected because absence of PostgreSQL rows
  // does not prove pre-cutover folios were unused. folio_minimo_ajustable is the only source of
  // truth for the lowest value this action may set when configured.
  private async assertBackwardAdjustmentSafe(client: PoolClient, series: DocumentSeriesRow, input: AdjustNextFolioInput): Promise<void> {
    if (!input.backwardFilesystemAcknowledged) {
      throw Object.assign(new Error('BACKWARD_ACKNOWLEDGEMENT_REQUIRED'), { code: 'BACKWARD_ACKNOWLEDGEMENT_REQUIRED' });
    }
    if (series.folioMinimoAjustable === null) {
      throw Object.assign(new Error('SERIES_FOLIO_FLOOR_UNCONFIGURED'), { code: 'SERIES_FOLIO_FLOOR_UNCONFIGURED' });
    }

    const rangeStart = input.nextFolio;
    const rangeEnd = series.siguiente_folio - 1;

    const remissionConflicts = await client.query(`
      SELECT 1 FROM operacion.remisiones
      WHERE serie_id = $1 AND folio BETWEEN $2 AND $3 AND estatus <> 'CANCELADA'
      LIMIT 1`, [series.serie_id, rangeStart, rangeEnd]);
    if (remissionConflicts.rows[0]) {
      throw Object.assign(new Error('SERIES_FOLIO_REMISSION_CONFLICT'), { code: 'SERIES_FOLIO_REMISSION_CONFLICT' });
    }

    // Deliberately no estatus filter — RESERVADA, APLICADA, and ABANDONADA all block. Abandoned
    // reservations are never silently recycled by this action (Phase 12B.2 §I.6).
    const reservationConflicts = await client.query(`
      SELECT 1 FROM operacion.reservas_folios
      WHERE serie_id = $1 AND folio_inicial <= $3 AND folio_final >= $2
      LIMIT 1`, [series.serie_id, rangeStart, rangeEnd]);
    if (reservationConflicts.rows[0]) {
      throw Object.assign(new Error('SERIES_FOLIO_RESERVATION_CONFLICT'), { code: 'SERIES_FOLIO_RESERVATION_CONFLICT' });
    }
  }

  private normalizeSeries(series: RawDocumentSeriesRow): Omit<DocumentSeriesRow, 'folioMinimoAjustable'> {
    return { ...series, siguiente_folio: Number(series.siguiente_folio) };
  }

  private normalizeLockedSeries(series: RawLockedSeriesRow): DocumentSeriesRow {
    return {
      serie_id: series.serie_id,
      codigo: series.codigo,
      nombre: series.nombre,
      estatus: series.estatus,
      siguiente_folio: Number(series.siguiente_folio),
      folioMinimoAjustable: series.folio_minimo_ajustable === null ? null : Number(series.folio_minimo_ajustable)
    };
  }

  private normalizeAdjustment(adjustment: RawSeriesAdjustmentRow): SeriesAdjustmentRow {
    return {
      ...adjustment,
      siguiente_folio_anterior: Number(adjustment.siguiente_folio_anterior),
      siguiente_folio_nuevo: Number(adjustment.siguiente_folio_nuevo)
    };
  }
}
