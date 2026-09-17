import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';

export type AutomationTriggerActionType = 'RUN' | 'REPROCESS';
export type AutomationTriggerOutcome = 'TRIGGERED' | 'NOTHING_TO_REPROCESS' | 'UPSTREAM_ERROR';

interface AuditIdentityLike {
  userId?: string | null;
  userEmail?: string | null;
}

// Insert-only audit/history for manual automation-trigger requests (originally PN1.2 §8, for
// Payment Notifications' Reprocesar). This is explicitly NOT a locking or state-machine mechanism
// — every row already represents a finished decision at the moment it was written. The real
// reprocess idempotency/claim gate lives entirely in n8n's own atomic state-transition guard on
// the targeted row (see PaymentNotificationsRepository.findReprocessableCorreoByExecutionId's
// comment for the current eligibility rules it mirrors — deliberately not restated here as one
// fixed SQL statement, since n8n's own logic can evolve independently). Never read back for
// business logic; never expose target_reference through any API DTO.
//
// PN1.2 final scope cleanup: Payment Notifications removed its own "Ejecutar ahora" (RUN) manual
// control — the underlying n8n workflow already polls independently, so a manual trigger for it
// added no value. AutomationTriggerActionType still includes 'RUN' generically, and the
// action_type DB constraint is intentionally left as-is rather than migrated: a future automation
// module (e.g. Audi, Caterpillar) may legitimately need its own manual "run now" control, and this
// table/type already supports that shape without any schema change.
@Injectable()
export class AutomationTriggerRequestsRepository {
  constructor(private readonly database: DatabaseService) {}

  async record(
    automationCode: string,
    actionType: AutomationTriggerActionType,
    outcome: AutomationTriggerOutcome,
    requestId: string,
    identity: AuditIdentityLike,
    targetReference: string | null = null
  ): Promise<void> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await this.setAuditContext(client, requestId, identity);
      await client.query(
        `INSERT INTO ops.automation_trigger_requests
          (automation_code, action_type, requested_by_user_id, requested_by_email, outcome, target_reference)
        VALUES ($1, $2, $3, $4, $5, $6)`,
        [automationCode, actionType, identity.userId ?? null, identity.userEmail ?? null, outcome, targetReference]
      );
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the original database error. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  private async setAuditContext(client: PoolClient, requestId: string, identity: AuditIdentityLike): Promise<void> {
    await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']);
    await client.query("SELECT set_config('app.request_id', $1, true)", [requestId]);
    await client.query("SELECT set_config('app.user_id', COALESCE($1, ''), true)", [identity.userId ?? null]);
    await client.query("SELECT set_config('app.user_email', COALESCE($1, ''), true)", [identity.userEmail ?? null]);
  }
}
