import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '../../config/environment';
import type { AudiRecoveryAction } from './audi-recovery.repository';

const WEBHOOK_TIMEOUT_MS = 10_000;
const WEBHOOK_HEADER_NAME = 'X-Daubert-Automation-Token';
const DISPATCH_STATUSES = ['DISPATCHED', 'ALREADY_DISPATCHED'] as const;
const STOP_STATUSES = ['STOP_REQUESTED', 'NOT_RUNNING', 'ALREADY_FINISHED'] as const;
const REJECTIONS = ['NOT_FOUND', 'NOT_ELIGIBLE_STATE', 'STALE_ATTEMPT', 'OUTSIDE_TEST_SCOPE', 'OUTSIDE_ALLOWED_SCOPE'] as const;

type AcceptedStatus = typeof DISPATCH_STATUSES[number] | typeof STOP_STATUSES[number];
export type AudiRecoveryWebhookResult =
  | { kind: 'ACCEPTED'; status: AcceptedStatus }
  | { kind: 'REJECTED'; reason: typeof REJECTIONS[number] }
  | { kind: 'NOT_CONFIGURED' | 'TIMEOUT' | 'NETWORK_ERROR' | 'INVALID_RESPONSE' };

interface Dispatch {
  action: AudiRecoveryAction;
  actionId: string;
  executionId: string;
  reason: string;
}

@Injectable()
export class AudiRecoveryWebhookClient {
  constructor(private readonly config: ConfigService<EnvironmentConfig, true>) {}

  isConfigured(): boolean {
    const { url, token } = this.config.get('audiRecoveryWebhook', { infer: true });
    return Boolean(url && token);
  }

  async dispatch(input: Dispatch): Promise<AudiRecoveryWebhookResult> {
    const { url, token } = this.config.get('audiRecoveryWebhook', { infer: true });
    if (!url || !token) return { kind: 'NOT_CONFIGURED' };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [WEBHOOK_HEADER_NAME]: token },
        body: JSON.stringify({ contractVersion: 1, ...input }),
        redirect: 'error',
        signal: controller.signal
      });
      const result = await this.parseResponse(response, input);
      return controller.signal.aborted ? { kind: 'TIMEOUT' } : result;
    } catch {
      return controller.signal.aborted ? { kind: 'TIMEOUT' } : { kind: 'NETWORK_ERROR' };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseResponse(response: Response, input: Dispatch): Promise<AudiRecoveryWebhookResult> {
    if (!response.ok && ![400, 404, 409, 422].includes(response.status)) return { kind: 'NETWORK_ERROR' };
    const body: unknown = await response.json().catch(() => null);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return { kind: 'INVALID_RESPONSE' };
    const payload = body as Record<string, unknown>;

    if (payload.accepted === false) {
      const reason = REJECTIONS.find((code) => code === payload.error);
      return reason ? { kind: 'REJECTED', reason } : { kind: 'INVALID_RESPONSE' };
    }
    if (!response.ok || payload.accepted !== true || payload.actionId !== input.actionId) {
      return { kind: 'INVALID_RESPONSE' };
    }
    const dispatchStatus = DISPATCH_STATUSES.find((status) => status === payload.status);
    if (dispatchStatus) return { kind: 'ACCEPTED', status: dispatchStatus };
    const stopStatus = STOP_STATUSES.find((status) => status === payload.status);
    if (input.action === 'STOP' && stopStatus && typeof payload.n8nExecutionId === 'string' &&
      /^[1-9]\d*$/.test(payload.n8nExecutionId)) return { kind: 'ACCEPTED', status: stopStatus };
    return { kind: 'INVALID_RESPONSE' };
  }
}
