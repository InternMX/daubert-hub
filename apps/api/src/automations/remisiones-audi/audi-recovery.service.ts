import { HttpException, Injectable } from '@nestjs/common';
import type { AuditIdentity } from '../../common/authenticated-request';
import { audiDiagnostic, audiSourceFilename } from './audi-detail-presentation';
import { AudiExecutionsRepository } from './audi-executions.repository';
import {
  AUDI_RECOVERY_ACTIONS, AudiRecoveryNotInstalled, AudiRecoveryRepository,
  type AudiRecoveryAction, type AudiRecoveryDetailRow
} from './audi-recovery.repository';
import { AudiRecoveryWebhookClient } from './audi-recovery-webhook.client';

type UnavailableCode = 'INTEGRATION_NOT_CONFIGURED' | 'RECOVERY_NOT_INSTALLED' |
  'TIMEOUT' | 'NETWORK_ERROR' | 'INVALID_RESPONSE';

const unavailable = {
  INTEGRATION_NOT_CONFIGURED: [503, 'La integración de recuperación de Audi no está configurada.'],
  RECOVERY_NOT_INSTALLED: [503, 'La recuperación de Audi no está instalada.'],
  TIMEOUT: [504, 'La integración de Audi no respondió a tiempo. El estado de la acción es desconocido. Consulta el historial antes de reintentar.'],
  NETWORK_ERROR: [502, 'No se pudo confirmar el despacho de la acción de Audi. Consulta el historial antes de reintentar.'],
  INVALID_RESPONSE: [502, 'La integración de Audi devolvió una respuesta no válida. Consulta el historial antes de reintentar.']
} as const;

// Only these fixed, local messages and the SQL-issued action id are exposed by the Audi filter.
export class AudiRecoveryUnavailable extends HttpException {
  constructor(code: UnavailableCode, actionId?: string) {
    const [statusCode, message] = unavailable[code];
    super({ statusCode, code, message, ...(actionId ? { actionId } : {}) }, statusCode);
  }
}

const noChangeStatuses = new Set(['ALREADY_REPROCESSED', 'ALREADY_COMPLETED', 'ALREADY_CANCELLED', 'NOT_RUNNING', 'ALREADY_FINISHED']);

function reject(code: string): never {
  switch (code) {
    case 'NOT_FOUND':
      throw new HttpException({ code, message: 'Ejecución de Audi no encontrada.' }, 404);
    case 'FORBIDDEN':
      throw new HttpException({ code, message: 'No tienes permisos para recuperar esta ejecución.' }, 403);
    case 'INVALID_REQUEST':
      throw new HttpException({ code, message: 'La solicitud de recuperación de Audi no es válida.' }, 400);
    case 'STALE_REVISION':
      throw new HttpException({ code, message: 'La ejecución cambió. Actualiza el detalle e inténtalo de nuevo.' }, 409);
    default:
      throw new HttpException({ code, message: 'La acción no está disponible para esta ejecución de Audi.' }, 409);
  }
}

@Injectable()
export class AudiRecoveryService {
  constructor(
    private readonly repository: AudiRecoveryRepository,
    private readonly webhook: AudiRecoveryWebhookClient,
    private readonly executions: AudiExecutionsRepository
  ) {}

  async getDetail(executionId: string, isAdmin: boolean) {
    let detail: AudiRecoveryDetailRow | null = null;
    try {
      detail = await this.repository.detail(executionId);
    } catch (error) {
      if (!(error instanceof AudiRecoveryNotInstalled)) throw error;
    }

    const configured = this.webhook.isConfigured();
    return {
      model: detail?.model ?? 'LEGACY',
      revision: detail?.revision ?? null,
      reservation: detail?.reservation ?? null,
      artifacts: (detail?.artifacts ?? []).map((artifact) => ({
        type: artifact.type, folio: artifact.folio, version: artifact.version, current: artifact.current,
        fileName: audiSourceFilename(artifact.fileName), sizeBytes: artifact.sizeBytes, sha256: artifact.sha256,
        status: artifact.status, verifiedAt: artifact.verifiedAt, actionId: artifact.actionId
      })),
      recoveryAttempts: (detail?.attempts ?? []).map((attempt) => ({
        actionId: attempt.accion_id, action: attempt.accion, status: attempt.estado,
        resultCode: attempt.codigo_resultado && /^[A-Z][A-Z0-9_]{0,63}$/.test(attempt.codigo_resultado) ? attempt.codigo_resultado : null,
        reason: attempt.motivo, actorName: attempt.actor_nombre, createdAt: attempt.created_at,
        lastHeartbeatAt: attempt.ultimo_latido_en, expiresAt: attempt.expira_en, finishedAt: attempt.finished_at,
        error: audiDiagnostic(attempt.error)
      })),
      availableActions: AUDI_RECOVERY_ACTIONS.map((action) => {
        const eligibility = detail?.availableActions.find((entry) => entry.action === action);
        const disabledReason = !isAdmin ? 'FORBIDDEN'
          : !eligibility ? 'RECOVERY_NOT_INSTALLED'
          : !eligibility.enabled ? eligibility.disabledReason
          : configured ? null : 'INTEGRATION_NOT_CONFIGURED';
        return { action, enabled: disabledReason === null, disabledReason };
      })
    };
  }

  async requestAction(executionId: string, action: AudiRecoveryAction, reason: string, expectedRevision: string | null,
    identity: AuditIdentity, requestId: string) {
    if (!this.webhook.isConfigured()) throw new AudiRecoveryUnavailable('INTEGRATION_NOT_CONFIGURED');

    const respond = (status: string, actionId: string | null, statusCode = 200, accepted = true, childExecutionId?: string | null) => ({
      statusCode,
      data: { accepted, status, actionId, executionId, ...(childExecutionId ? { childExecutionId } : {}) }
    });

    try {
      await this.repository.sweepExpired();
      const authorization = await this.repository.authorize(executionId, action, reason, expectedRevision, identity.userId, requestId);
      const { outcome, accion_id: actionId, attempt_estado: state, claimed } = authorization;
      if (noChangeStatuses.has(outcome)) {
        const child = outcome === 'ALREADY_REPROCESSED' ? (await this.executions.findById(executionId))?.child_execution_id : null;
        return respond(outcome, actionId, 200, true, child);
      }
      if (outcome !== 'AUTHORIZED' && outcome !== 'ACTION_IN_PROGRESS') reject(outcome);
      if (!actionId || !state) throw new Error('Audi recovery authorization returned no attempt.');
      if (state !== 'EN_CURSO') return respond(state, actionId, 200, state === 'COMPLETADA');
      if (claimed !== false) return respond('ACTION_IN_PROGRESS', actionId);

      if (outcome === 'ACTION_IN_PROGRESS') {
        // SQL returns the active attempt across all actions, even if this request has a different reason.
        const detail = await this.repository.detail(executionId);
        const attempt = detail?.attempts.find((entry) => entry.accion_id === actionId);
        if (!attempt) return respond('ACTION_IN_PROGRESS', actionId);
        if (attempt.estado !== 'EN_CURSO') {
          return respond(attempt.estado, actionId, 200, attempt.estado === 'COMPLETADA', attempt.ejecucion_hija_id);
        }
        if (attempt.claimed) return respond('ACTION_IN_PROGRESS', actionId);
        action = attempt.accion;
        reason = attempt.motivo;
      }

      const result = await this.webhook.dispatch({ action, actionId, executionId, reason });
      switch (result.kind) {
        case 'ACCEPTED':
          if (outcome === 'ACTION_IN_PROGRESS') return respond(outcome, actionId);
          if (noChangeStatuses.has(result.status)) return respond(result.status, actionId);
          return respond(action === 'STOP' ? 'STOP_REQUESTED' : 'DISPATCHED', actionId, 202);
        case 'REJECTED':
          if (await this.repository.failDispatch(actionId, result.reason) === 'ACTION_IN_PROGRESS') {
            return respond('ACTION_IN_PROGRESS', actionId);
          }
          return reject(result.reason);
        case 'NOT_CONFIGURED':
          throw new AudiRecoveryUnavailable('INTEGRATION_NOT_CONFIGURED');
        default:
          throw new AudiRecoveryUnavailable(result.kind, actionId);
      }
    } catch (error) {
      if (error instanceof AudiRecoveryNotInstalled) throw new AudiRecoveryUnavailable('RECOVERY_NOT_INSTALLED');
      throw error;
    }
  }
}
