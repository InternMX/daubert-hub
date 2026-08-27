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

interface RawSeriesAdjustmentRow extends QueryResultRow {
  siguiente_folio_anterior: string;
  siguiente_folio_nuevo: string;
  motivo: string;
  usuario_email: string | null;
  created_at: Date | string;
}

export interface DocumentSeriesConfiguration {
  automation: AutomationRow;
  series: DocumentSeriesRow;
  adjustments: SeriesAdjustmentRow[];
}

interface AuditUser {
  userId?: string | null;
  userEmail?: string | null;
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

  async adjustNextFolio(automationCode: string, seriesCode: string, nextFolio: number, reason: string, requestId: string, user: AuditUser = {}): Promise<void> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await this.setAuditContext(client, requestId);
      await this.assertAutomationExists(client, automationCode);
      const series = await this.lockSeries(client, seriesCode);
      if (!series) throw Object.assign(new Error('DOCUMENT_SERIES_NOT_FOUND'), { code: 'DOCUMENT_SERIES_NOT_FOUND' });
      if (series.siguiente_folio === nextFolio) throw Object.assign(new Error('DOCUMENT_SERIES_FOLIO_UNCHANGED'), { code: 'DOCUMENT_SERIES_FOLIO_UNCHANGED' });

      await client.query(`
        UPDATE operacion.series_documentales
        SET siguiente_folio = $1
        WHERE serie_id = $2`, [nextFolio, series.serie_id]);
      await client.query(`
        INSERT INTO operacion.ajustes_series
          (serie_id, siguiente_folio_anterior, siguiente_folio_nuevo, motivo, usuario_id, usuario_email)
        VALUES ($1, $2, $3, $4, $5, $6)`, [series.serie_id, series.siguiente_folio, nextFolio, reason, user.userId ?? null, user.userEmail ?? null]);
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the original database error. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  private async setAuditContext(client: PoolClient, requestId: string): Promise<void> {
    await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']);
    await client.query("SELECT set_config('app.request_id', $1, true)", [requestId]);
  }

  private async assertAutomationExists(client: PoolClient, code: string): Promise<void> {
    const result = await client.query('SELECT 1 FROM ops.automatizaciones WHERE codigo = $1', [code]);
    if (!result.rows[0]) throw Object.assign(new Error('AUTOMATION_NOT_FOUND'), { code: 'AUTOMATION_NOT_FOUND' });
  }

  private async lockSeries(client: PoolClient, code: string): Promise<DocumentSeriesRow | null> {
    const result = await client.query<RawDocumentSeriesRow>(`
      SELECT serie_id::text, codigo, nombre, siguiente_folio, estatus
      FROM operacion.series_documentales
      WHERE codigo = $1
      FOR UPDATE`, [code]);
    return result.rows[0] ? this.normalizeSeries(result.rows[0]) : null;
  }

  private normalizeSeries(series: RawDocumentSeriesRow): DocumentSeriesRow {
    return { ...series, siguiente_folio: Number(series.siguiente_folio) };
  }

  private normalizeAdjustment(adjustment: RawSeriesAdjustmentRow): SeriesAdjustmentRow {
    return {
      ...adjustment,
      siguiente_folio_anterior: Number(adjustment.siguiente_folio_anterior),
      siguiente_folio_nuevo: Number(adjustment.siguiente_folio_nuevo)
    };
  }
}
