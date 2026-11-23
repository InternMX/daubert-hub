import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../../database/database.service';

export const AUDI_RECOVERY_ACTIONS = ['REPROCESS', 'RECONCILE', 'STOP', 'CANCEL'] as const;
export type AudiRecoveryAction = typeof AUDI_RECOVERY_ACTIONS[number];
type AttemptState = 'EN_CURSO' | 'COMPLETADA' | 'FALLIDA' | 'EXPIRADA';

interface RecoveryAttemptRow {
  accion_id: string;
  accion: AudiRecoveryAction;
  estado: AttemptState;
  claimed: boolean;
  codigo_resultado: string | null;
  motivo: string;
  actor_nombre: string | null;
  created_at: string;
  ultimo_latido_en: string | null;
  expira_en: string;
  finished_at: string | null;
  error: string | null;
  ejecucion_hija_id: string | null;
}

interface RecoveryArtifact {
  type: string;
  folio: string | null;
  version: number;
  current: boolean;
  fileName: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  status: string;
  verifiedAt: string;
  actionId: string | null;
}

export interface AudiRecoveryDetailRow {
  model: 'LEGACY' | 'ATOMIC';
  revision: string;
  reservation: { firstFolio: string; lastFolio: string; quantity: number; status: string } | null;
  attempts: RecoveryAttemptRow[];
  artifacts: RecoveryArtifact[];
  availableActions: { action: AudiRecoveryAction; enabled: boolean; disabledReason: string | null }[];
}

interface AuthorizationRow {
  outcome: string;
  accion_id: string | null;
  revision: string | null;
  attempt_estado: AttemptState | null;
  claimed: boolean | null;
}

export class AudiRecoveryNotInstalled extends Error {}

@Injectable()
export class AudiRecoveryRepository {
  constructor(private readonly database: DatabaseService) {}

  async detail(executionId: string): Promise<AudiRecoveryDetailRow | null> {
    const [row] = await this.query<{ detail: AudiRecoveryDetailRow | null }>(
      'SELECT ops.fn_detalle_recuperacion_audi_test($1::bigint) AS detail', [executionId]);
    return row?.detail ?? null;
  }

  async sweepExpired(): Promise<void> {
    await this.query('SELECT ops.fn_expirar_acciones_audi_test()', []);
  }

  async authorize(executionId: string, action: AudiRecoveryAction, reason: string, expectedRevision: string | null,
    actorId: string | null, requestId: string): Promise<AuthorizationRow> {
    const [row] = await this.query<AuthorizationRow>(`
      SELECT outcome, accion_id::text AS accion_id, revision, attempt_estado, claimed
      FROM ops.fn_autorizar_accion_audi_test($1::bigint, $2::text, $3::text, $4::text, $5::bigint, $6::text)`,
    [executionId, action, reason, expectedRevision, actorId, requestId]);
    if (!row) throw new Error('Audi recovery SQL returned no authorization.');
    return row;
  }

  async failDispatch(actionId: string, code: string): Promise<string> {
    const [row] = await this.query<{ outcome: string }>(
      'SELECT ops.fn_fallar_despacho_accion_audi_test($1::bigint, $2::text) AS outcome', [actionId, code]);
    if (!row) throw new Error('Audi recovery SQL returned no dispatch outcome.');
    return row.outcome;
  }

  private async query<Row extends QueryResultRow>(sql: string, values: unknown[]): Promise<Row[]> {
    try {
      return await this.database.query<Row>(sql, values);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error &&
        (error.code === '42883' || error.code === '42P01')) throw new AudiRecoveryNotInstalled();
      throw error;
    }
  }
}
