import { apiBaseUrl as baseUrl } from './api';

export interface AutomationSeriesConfiguration {
  automation: { code: string; name: string; status: string };
  series: { code: string; name: string; nextFolio: number; status: string };
  adjustments: Array<{ previousFolio: number; newFolio: number; reason: string; userEmail: string | null; createdAt: string }>;
}

export class AutomationApiError extends Error {
  constructor(public readonly status: number, public readonly code: string | undefined) {
    super('Automation API request failed');
  }
}

async function request(path: string, init?: RequestInit): Promise<AutomationSeriesConfiguration> {
  let response: Response;
  try { response = await fetch(`${baseUrl}${path}`, init); } catch { throw new AutomationApiError(0, undefined); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
    throw new AutomationApiError(response.status, code);
  }
  if (typeof body !== 'object' || body === null || !('data' in body)) throw new AutomationApiError(response.status, undefined);
  return body.data as AutomationSeriesConfiguration;
}

export function getDocumentSeries(automationCode: string, seriesCode: string): Promise<AutomationSeriesConfiguration> {
  return request(`/automations/${encodeURIComponent(automationCode)}/document-series/${encodeURIComponent(seriesCode)}`);
}

export function adjustDocumentSeries(automationCode: string, seriesCode: string, input: { nextFolio: number; reason: string }): Promise<AutomationSeriesConfiguration> {
  return request(`/automations/${encodeURIComponent(automationCode)}/document-series/${encodeURIComponent(seriesCode)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
}
