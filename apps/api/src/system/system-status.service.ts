import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '../config/environment';

export type N8nAvailability = 'UP' | 'DOWN' | 'NOT_CONFIGURED';

export interface SystemStatusResponse {
  status: 'operational' | 'degraded';
  n8n: {
    status: N8nAvailability;
    latencyMs: number | null;
    checkedAt: string;
  };
}

const HEALTH_TIMEOUT_MS = 3_000;
const HEALTH_HEADER_NAME = 'X-Daubert-Automation-Token';

// Reports whether the n8n automation service is reachable, by calling its dedicated health-check
// webhook ("Daubert Hub - n8n Health Check", Header Auth) server-to-server. Deliberately separate
// from HealthService / GET /api/health: n8n being down must never make the API itself look down.
// Every failure mode (non-2xx, network error, DNS/TLS failure, timeout) collapses to DOWN — the
// webhook URL, token, n8n response body and underlying error never leave this method, are never
// logged, and are never returned.
@Injectable()
export class SystemStatusService {
  constructor(private readonly config: ConfigService<EnvironmentConfig, true>) {}

  async getStatus(): Promise<SystemStatusResponse> {
    const { url, token } = this.config.get('n8nHealthWebhook', { infer: true });
    const checkedAt = new Date().toISOString();
    if (!url || !token) return this.build('NOT_CONFIGURED', null, checkedAt);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const startedAt = performance.now();
    try {
      const response = await fetch(url, { method: 'GET', headers: { [HEALTH_HEADER_NAME]: token }, signal: controller.signal });
      if (!response.ok) return this.build('DOWN', null, checkedAt);
      return this.build('UP', Math.max(0, Math.round(performance.now() - startedAt)), checkedAt);
    } catch {
      return this.build('DOWN', null, checkedAt);
    } finally {
      clearTimeout(timeout);
    }
  }

  private build(status: N8nAvailability, latencyMs: number | null, checkedAt: string): SystemStatusResponse {
    return { status: status === 'UP' ? 'operational' : 'degraded', n8n: { status, latencyMs, checkedAt } };
  }
}
