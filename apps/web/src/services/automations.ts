import { apiBaseUrl as baseUrl } from './api';

export interface AutomationSeriesConfiguration {
  automation: { code: string; name: string; status: string };
  series: { code: string; name: string; nextFolio: number; status: string };
  adjustments: Array<{ previousFolio: number; newFolio: number; reason: string; userEmail: string | null; createdAt: string }>;
}

// Phase 12B.2: serverMessage carries the backend's own sanitized Spanish message (e.g. "El folio
// actual cambió desde que se cargó esta pantalla...") when the API supplied one — the dialog
// displays this directly instead of maintaining a second, duplicate code->message translation
// table on the frontend. Falls back to a generic message when absent (network failure, malformed
// body, or a code the backend didn't attach a message to).
export class AutomationApiError extends Error {
  constructor(public readonly status: number, public readonly code: string | undefined, public readonly serverMessage: string | undefined = undefined) {
    super('Automation API request failed');
  }
}

async function request(path: string, init?: RequestInit): Promise<AutomationSeriesConfiguration> {
  let response: Response;
  try { response = await fetch(`${baseUrl}${path}`, init); } catch { throw new AutomationApiError(0, undefined); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : null;
    const code = record && typeof record.code === 'string' ? record.code : undefined;
    const message = record && typeof record.message === 'string' ? record.message : undefined;
    throw new AutomationApiError(response.status, code, message);
  }
  if (typeof body !== 'object' || body === null || !('data' in body)) throw new AutomationApiError(response.status, undefined);
  return body.data as AutomationSeriesConfiguration;
}

export function getDocumentSeries(automationCode: string, seriesCode: string): Promise<AutomationSeriesConfiguration> {
  return request(`/automations/${encodeURIComponent(automationCode)}/document-series/${encodeURIComponent(seriesCode)}`);
}

// Phase 12B.2 §E: expectedCurrentFolio is always required now (optimistic-concurrency guard,
// re-validated server-side under a row lock regardless of what the UI last displayed).
// backwardFilesystemAcknowledged is only meaningful when nextFolio < expectedCurrentFolio.
export interface AdjustDocumentSeriesInput {
  expectedCurrentFolio: number;
  nextFolio: number;
  reason: string;
  backwardFilesystemAcknowledged?: boolean;
}

export function adjustDocumentSeries(automationCode: string, seriesCode: string, input: AdjustDocumentSeriesInput): Promise<AutomationSeriesConfiguration> {
  return request(`/automations/${encodeURIComponent(automationCode)}/document-series/${encodeURIComponent(seriesCode)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
}
