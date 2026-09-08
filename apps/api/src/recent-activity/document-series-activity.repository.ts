import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';

// operacion.ajustes_series is its own append-only ledger for manual folio
// adjustments (actor, before/after folio, reason, timestamp) — it carries
// no audit.cambios trigger by design (see Phase 9A) and is never copied
// there. This repository reads that ledger directly as an independent
// Recent Activity source, exactly like PaymentNotificationActivityRepository
// and RemisionesAudiActivityRepository already do for their own tables.
export interface DocumentSeriesActivityRow extends QueryResultRow {
  id: string;
  series_name: string;
  folio_before: string;
  folio_after: string;
  // usuario_email here is ajustes_series' own historical snapshot column —
  // same "historical vs. current" distinction as audit.cambios.usuario_email
  // (see recent-activity.repository.ts).
  actor_id: string | null;
  actor_email: string | null;
  occurred_at: Date | string;
}

@Injectable()
export class DocumentSeriesActivityRepository {
  constructor(private readonly database: DatabaseService) {}

  async findRecent(limit: number): Promise<DocumentSeriesActivityRow[]> {
    return this.database.query<DocumentSeriesActivityRow>(`
      SELECT
        adjustment.ajuste_id::text AS id,
        series.nombre AS series_name,
        adjustment.siguiente_folio_anterior::text AS folio_before,
        adjustment.siguiente_folio_nuevo::text AS folio_after,
        adjustment.usuario_id::text AS actor_id,
        adjustment.usuario_email AS actor_email,
        adjustment.created_at AS occurred_at
      FROM operacion.ajustes_series adjustment
      JOIN operacion.series_documentales series ON series.serie_id = adjustment.serie_id
      ORDER BY adjustment.created_at DESC, adjustment.ajuste_id DESC
      LIMIT $1`, [limit]);
  }

  // Same best-effort current-display_name enrichment as
  // RecentActivityRepository — see its comment for why this can never
  // fabricate a name.
  async findActorDisplayNames(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.database.query<{ id: string; display_name: string }>(`
      SELECT user_id::text AS id, display_name
      FROM security.users
      WHERE user_id = ANY($1::bigint[])`, [userIds]);
    return new Map(rows.map((row) => [row.id, row.display_name]));
  }
}
