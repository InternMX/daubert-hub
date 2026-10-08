import { apiBaseUrl } from './api';

export type N8nAvailability = 'UP' | 'DOWN' | 'NOT_CONFIGURED';

const n8nAvailabilities = new Set<N8nAvailability>(['UP', 'DOWN', 'NOT_CONFIGURED']);

export interface SystemStatus {
  n8n: {
    status: N8nAvailability;
    latencyMs: number | null;
    checkedAt: string;
  };
}

// GET /api/system/status (authenticated). Validates the response shape and keeps only the fields
// the UI renders; throws a generic error on anything unexpected so callers can degrade quietly.
export async function getSystemStatus(signal?: AbortSignal): Promise<SystemStatus> {
  const response = await fetch(`${apiBaseUrl}/system/status`, { signal });
  const body: unknown = await response.json().catch(() => null);
  const n8n = typeof body === 'object' && body !== null && 'n8n' in body ? (body as { n8n: unknown }).n8n : null;
  if (!response.ok || typeof n8n !== 'object' || n8n === null) throw new Error('SYSTEM_STATUS_UNAVAILABLE');

  const { status, latencyMs, checkedAt } = n8n as Record<string, unknown>;
  if (typeof status !== 'string' || !n8nAvailabilities.has(status as N8nAvailability) || typeof checkedAt !== 'string') {
    throw new Error('SYSTEM_STATUS_UNAVAILABLE');
  }
  return { n8n: { status: status as N8nAvailability, latencyMs: typeof latencyMs === 'number' ? latencyMs : null, checkedAt } };
}
