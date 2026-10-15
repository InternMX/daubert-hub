import { apiBaseUrl as baseUrl } from './api';

export type AudiProcessingOutcome = 'COMPLETED' | 'FAILED' | 'PROCESSING' | 'CANCELLED';
// Backend-authoritative per-row acknowledgement state (Phase 10I UX refinement). Non-null on at
// most one row in a list response — the row currently resolved as the outstanding problem. Never
// derive this on the frontend by comparing outcomes across rows.
export type AudiExecutionReviewStatus = 'REQUIRED' | 'REVIEWED' | null;

export interface AudiProcessingSummary {
  executionId: string;
  occurredAt: string;
  outcome: AudiProcessingOutcome;
  generatedCount: number;
  firstFolio: string | null;
  lastFolio: string | null;
  reviewStatus: AudiExecutionReviewStatus;
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

export interface AudiExecutionDetail {
  executionId: string;
  outcome: AudiProcessingOutcome;
  startedAt: string;
  finishedAt: string | null;
  generatedCount: number;
  sourceDocument: { documentId: string; filename: string | null } | null;
  latestErrorMessage: string | null;
  remittances: { remissionId: string; seriesCode: string; folio: string; documentDate: string; status: string }[];
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

const reviewStatuses = new Set<Exclude<AudiExecutionReviewStatus, null>>(['REQUIRED', 'REVIEWED']);

function isReviewStatus(value: unknown): value is AudiExecutionReviewStatus {
  return value === null || (typeof value === 'string' && reviewStatuses.has(value as Exclude<AudiExecutionReviewStatus, null>));
}

function isSummary(value: unknown): value is AudiProcessingSummary {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return isBigintId(item.executionId) && isIsoDateString(item.occurredAt)
    && typeof item.outcome === 'string' && outcomes.has(item.outcome as AudiProcessingOutcome)
    && isNonNegativeFiniteInteger(item.generatedCount)
    && isNullableFolio(item.firstFolio)
    && isNullableFolio(item.lastFolio)
    && isReviewStatus(item.reviewStatus);
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

function isBigintId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) && value.length <= 19 && BigInt(value) <= 9223372036854775807n;
}

function isDetail(value: unknown): value is AudiExecutionDetail {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  const source = item.sourceDocument as Record<string, unknown> | null;
  return isBigintId(item.executionId)
    && typeof item.outcome === 'string' && outcomes.has(item.outcome as AudiProcessingOutcome)
    && isIsoDateString(item.startedAt) && (item.finishedAt === null || isIsoDateString(item.finishedAt))
    && isNonNegativeFiniteInteger(item.generatedCount)
    && (item.latestErrorMessage === null || typeof item.latestErrorMessage === 'string')
    && (source === null || (typeof source === 'object' && source !== null && isBigintId(source.documentId) && (source.filename === null || typeof source.filename === 'string')))
    && Array.isArray(item.remittances) && item.remittances.every((value: unknown) => {
      if (typeof value !== 'object' || value === null) return false;
      const remission = value as Record<string, unknown>;
      return isBigintId(remission.remissionId) && isBigintId(remission.folio)
        && typeof remission.seriesCode === 'string' && typeof remission.status === 'string'
        && typeof remission.documentDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(remission.documentDate)
        && isIsoDateString(remission.documentDate);
    });
}

export async function getAudiExecution(executionId: string): Promise<AudiExecutionDetail> {
  let response: Response;
  try { response = await fetch(`${baseUrl}/automations/remissions/audi/executions/${encodeURIComponent(executionId)}`); }
  catch { throw new AudiExecutionsApiError(0); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof body !== 'object' || body === null || !('data' in body) || !isDetail(body.data)) {
    throw new AudiExecutionsApiError(response.status);
  }
  return body.data;
}
