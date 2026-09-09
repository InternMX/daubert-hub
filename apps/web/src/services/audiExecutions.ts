import { apiBaseUrl as baseUrl } from './api';

export type AudiProcessingOutcome = 'COMPLETED' | 'FAILED' | 'PROCESSING' | 'CANCELLED';

export interface AudiProcessingSummary {
  occurredAt: string;
  outcome: AudiProcessingOutcome;
  generatedCount: number;
  firstFolio: string | null;
  lastFolio: string | null;
}

export interface ListAudiExecutions {
  data: AudiProcessingSummary[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export class AudiExecutionsApiError extends Error {
  constructor(public readonly status: number) {
    super('Audi executions API request failed');
  }
}

const outcomes = new Set<AudiProcessingOutcome>(['COMPLETED', 'FAILED', 'PROCESSING', 'CANCELLED']);

function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime());
}

function isNonNegativeFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

// BIGINT-safe: folio is a bigint column in PostgreSQL, so it is validated as a string here, never
// coerced through Number().
function isNullableFolio(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isSummary(value: unknown): value is AudiProcessingSummary {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return isIsoDateString(item.occurredAt)
    && typeof item.outcome === 'string' && outcomes.has(item.outcome as AudiProcessingOutcome)
    && isNonNegativeFiniteInteger(item.generatedCount)
    && isNullableFolio(item.firstFolio)
    && isNullableFolio(item.lastFolio);
}

function isMeta(value: unknown): value is ListAudiExecutions['meta'] {
  if (typeof value !== 'object' || value === null) return false;
  const meta = value as Record<string, unknown>;
  return isNonNegativeFiniteInteger(meta.page) && meta.page >= 1
    && isNonNegativeFiniteInteger(meta.pageSize) && meta.pageSize >= 1
    && isNonNegativeFiniteInteger(meta.total)
    && isNonNegativeFiniteInteger(meta.totalPages);
}

function isListResponse(value: unknown): value is ListAudiExecutions {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  return Array.isArray(body.data) && body.data.every(isSummary) && isMeta(body.meta);
}

export async function listAudiExecutions(page: number, pageSize: number): Promise<ListAudiExecutions> {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  let response: Response;
  try { response = await fetch(`${baseUrl}/automations/remissions/audi/executions?${query}`); }
  catch { throw new AudiExecutionsApiError(0); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !isListResponse(body)) throw new AudiExecutionsApiError(response.status);
  return body;
}
