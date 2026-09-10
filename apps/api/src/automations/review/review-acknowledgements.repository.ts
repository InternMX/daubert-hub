import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../../database/database.service';

export interface ReviewAcknowledgementRow extends QueryResultRow {
  acknowledgement_id: string;
  automation_code: string;
  source_type: string;
  source_reference: string;
  source_occurred_at: Date | string;
  reviewed_at: Date | string;
  reviewed_by_user_id: string | null;
  reviewed_by_email: string;
}

interface AuditIdentityLike {
  userId?: string | null;
  userEmail?: string | null;
}

// Generic persistence for ops.automation_review_acknowledgements (Phase 10I). Deliberately not
// scoped to a single automation: automation_code is a free-standing identifier, never a foreign
// key to ops.automatizaciones, because PAYMENT_NOTIFICATIONS is intentionally not registered
// there (see the migration's rationale comment).
@Injectable()
export class ReviewAcknowledgementsRepository {
  constructor(private readonly database: DatabaseService) {}

  async findLatest(automationCode: string, sourceType: string, sourceReference: string): Promise<ReviewAcknowledgementRow | null> {
    const [row] = await this.database.query<ReviewAcknowledgementRow>(`
      SELECT
        acknowledgement_id::text,
        automation_code,
        source_type,
        source_reference,
        source_occurred_at,
        reviewed_at,
        reviewed_by_user_id::text,
        reviewed_by_email
      FROM ops.automation_review_acknowledgements
      WHERE automation_code = $1 AND source_type = $2 AND source_reference = $3`,
      [automationCode, sourceType, sourceReference]);
    return row ?? null;
  }

  // Idempotent and concurrency-safe: two near-simultaneous "Marcar como revisado" requests for
  // the exact same problematic processing race on uq_automation_review_acknowledgements_source.
  // ON CONFLICT DO NOTHING makes the losing request a no-op (never a 500), and both requests then
  // read back the same, single, winning row (Phase 10I §12).
  async acknowledge(
    automationCode: string,
    sourceType: string,
    sourceReference: string,
    sourceOccurredAt: string,
    requestId: string,
    identity: AuditIdentityLike
  ): Promise<ReviewAcknowledgementRow> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await this.setAuditContext(client, requestId, identity);
      await client.query(
        `INSERT INTO ops.automation_review_acknowledgements
          (automation_code, source_type, source_reference, source_occurred_at, reviewed_by_user_id, reviewed_by_email)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT ON CONSTRAINT uq_automation_review_acknowledgements_source DO NOTHING`,
        [automationCode, sourceType, sourceReference, sourceOccurredAt, identity.userId ?? null, identity.userEmail]
      );
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the original database error. */ }
      throw error;
    } finally {
      client.release();
    }
    const row = await this.findLatest(automationCode, sourceType, sourceReference);
    if (!row) throw new Error('Acknowledgement row not found immediately after insert.');
    return row;
  }

  private async setAuditContext(client: PoolClient, requestId: string, identity: AuditIdentityLike): Promise<void> {
    await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']);
    await client.query("SELECT set_config('app.request_id', $1, true)", [requestId]);
    await client.query("SELECT set_config('app.user_id', COALESCE($1, ''), true)", [identity.userId ?? null]);
    await client.query("SELECT set_config('app.user_email', COALESCE($1, ''), true)", [identity.userEmail ?? null]);
  }
}
