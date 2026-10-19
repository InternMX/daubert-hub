import { apiBaseUrl as baseUrl } from './api';
import type { PaymentAliasResolution } from './companyAliases';

export type PaymentNotificationProcessingStatus = 'PENDIENTE' | 'PROCESADO' | 'ERROR';
export type PaymentNotificationOutcomeStatus = 'COMPLETED' | 'PARTIAL' | 'FAILED' | null;
export type PaymentNotificationResultStatus = 'LISTO' | 'MANUAL' | 'ERROR' | 'OMITIDO';
// Backend-authoritative per-row acknowledgement state (Phase 10I UX refinement). Non-null on at
// most one row in a list response — the row currently resolved as the outstanding problem. Never
// derive this on the frontend by comparing outcomes across rows.
export type PaymentNotificationReviewStatus = 'REQUIRED' | 'REVIEWED' | null;

export interface PaymentNotificationExecutionSummary {
  executionId: string;
  createdAt: string;
  processedAt: string | null;
  processingStatus: PaymentNotificationProcessingStatus;
  outcomeStatus: PaymentNotificationOutcomeStatus;
  totalResults: number;
  readyCount: number;
  manualCount: number;
  errorCount: number;
  omittedCount: number;
  // File-level errors (PDFs n8n could not associate with a company). Independent from the
  // per-company counts above: never added to totalResults or errorCount.
  fileErrors: number;
  summarySent: boolean;
  summarySentAt: string | null;
  reviewStatus: PaymentNotificationReviewStatus;
  // PN1.2 §5: a plain per-row fact about the underlying email's own state — never derived from
  // outcomeStatus/reviewStatus on the frontend (PN1.1c proved those are not equivalent). Unlike
  // reviewStatus, this is not limited to "at most one row".
  reprocessAvailable: boolean;
}

export interface PaymentNotificationProviderResult {
  companyId: string;
  companyName: string | null;
  status: PaymentNotificationResultStatus;
  attentionReason: string | null;
}

export type PaymentNotificationFileError = {
  fileName: string;
  errorCode: string;
  detail: string | null;
  fileHash: string;
  // Current PostgreSQL catalog state; separate from the error originally recorded by n8n.
  aliasResolution?: PaymentAliasResolution | null;
};

export interface PaymentNotificationExecutionDetail extends PaymentNotificationExecutionSummary {
  results: PaymentNotificationProviderResult[];
  fileErrorDetails: PaymentNotificationFileError[];
}

export interface ListPaymentNotificationExecutions {
  data: PaymentNotificationExecutionSummary[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export class PaymentNotificationApiError extends Error {
  constructor(public readonly status: number) {
    super('Payment Notification API request failed');
  }
}

const processingStatuses = new Set<PaymentNotificationProcessingStatus>(['PENDIENTE', 'PROCESADO', 'ERROR']);
const outcomeStatuses = new Set<Exclude<PaymentNotificationOutcomeStatus, null>>(['COMPLETED', 'PARTIAL', 'FAILED']);
const resultStatuses = new Set<PaymentNotificationResultStatus>(['LISTO', 'MANUAL', 'ERROR', 'OMITIDO']);

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

// createdAt is always non-null and must parse to a real instant; processedAt/summarySentAt
// are nullable but, when present, must also parse — never trust an unparsable string through
// to rendering (see paymentNotificationPresentation.ts, which never falls back to "Invalid Date").
function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime());
}

function isNullableIsoDateString(value: unknown): value is string | null {
  return value === null || isIsoDateString(value);
}

function isOutcomeStatus(value: unknown): value is PaymentNotificationOutcomeStatus {
  return value === null || (typeof value === 'string' && outcomeStatuses.has(value as Exclude<PaymentNotificationOutcomeStatus, null>));
}

const reviewStatuses = new Set<Exclude<PaymentNotificationReviewStatus, null>>(['REQUIRED', 'REVIEWED']);

function isReviewStatus(value: unknown): value is PaymentNotificationReviewStatus {
  return value === null || (typeof value === 'string' && reviewStatuses.has(value as Exclude<PaymentNotificationReviewStatus, null>));
}

function isExecutionSummary(value: unknown): value is PaymentNotificationExecutionSummary {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.executionId === 'string' && item.executionId.length > 0
    && isIsoDateString(item.createdAt)
    && isNullableIsoDateString(item.processedAt)
    && typeof item.processingStatus === 'string' && processingStatuses.has(item.processingStatus as PaymentNotificationProcessingStatus)
    && isOutcomeStatus(item.outcomeStatus)
    && isNonNegativeFiniteNumber(item.totalResults)
    && isNonNegativeFiniteNumber(item.readyCount)
    && isNonNegativeFiniteNumber(item.manualCount)
    && isNonNegativeFiniteNumber(item.errorCount)
    && isNonNegativeFiniteNumber(item.omittedCount)
    && isNonNegativeFiniteNumber(item.fileErrors)
    && typeof item.summarySent === 'boolean'
    && isNullableIsoDateString(item.summarySentAt)
    && isReviewStatus(item.reviewStatus)
    && typeof item.reprocessAvailable === 'boolean';
}

function isProviderResult(value: unknown): value is PaymentNotificationProviderResult {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.companyId === 'string' && item.companyId.length > 0
    && isNullableString(item.companyName)
    && typeof item.status === 'string' && resultStatuses.has(item.status as PaymentNotificationResultStatus)
    && isNullableString(item.attentionReason);
}

function isFileError(value: unknown): value is PaymentNotificationFileError {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.fileName === 'string' && item.fileName.length > 0
    && typeof item.errorCode === 'string' && item.errorCode.length > 0
    && isNullableString(item.detail)
    && typeof item.fileHash === 'string'
    && (item.aliasResolution === undefined || item.aliasResolution === null || isAliasResolution(item.aliasResolution));
}

function isAliasResolution(value: unknown): value is PaymentAliasResolution {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  if (typeof item.alias !== 'string' || typeof item.normalizedAlias !== 'string'
    || !['UNASSIGNED', 'ACTIVE', 'INACTIVE', 'CONFLICT', 'NAME_ONLY'].includes(String(item.state))) return false;
  const company = item.company as Record<string, unknown> | null;
  if (company !== null && (typeof company !== 'object' || typeof company.id !== 'string' || typeof company.name !== 'string')) return false;
  const assignment = item.assignment as Record<string, unknown> | null;
  if (assignment !== null && (typeof assignment !== 'object'
    || !['aliasId', 'companyId', 'companyName', 'alias', 'normalizedAlias', 'type', 'updatedAt'].every((key) => typeof assignment[key] === 'string')
    || !['ACTIVO', 'INACTIVO'].includes(String(assignment.status)))) return false;
  if (item.state === 'ACTIVE') return assignment?.status === 'ACTIVO' && company?.id === assignment.companyId;
  if (item.state === 'INACTIVE') return assignment?.status === 'INACTIVO' && company === null;
  if (item.state === 'NAME_ONLY') return assignment === null && company !== null;
  return assignment === null && company === null;
}

function isExecutionDetail(value: unknown): value is PaymentNotificationExecutionDetail {
  if (!isExecutionSummary(value)) return false;
  const record = value as unknown as Record<string, unknown>;
  return Array.isArray(record.results) && record.results.every(isProviderResult)
    && Array.isArray(record.fileErrorDetails) && record.fileErrorDetails.every(isFileError);
}

function isMeta(value: unknown): value is ListPaymentNotificationExecutions['meta'] {
  if (typeof value !== 'object' || value === null) return false;
  const meta = value as Record<string, unknown>;
  return isNonNegativeFiniteNumber(meta.page) && meta.page >= 1
    && isNonNegativeFiniteNumber(meta.pageSize) && meta.pageSize >= 1
    && isNonNegativeFiniteNumber(meta.total)
    && isNonNegativeFiniteNumber(meta.totalPages);
}

function isListResponse(value: unknown): value is ListPaymentNotificationExecutions {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  return Array.isArray(body.data) && body.data.every(isExecutionSummary) && isMeta(body.meta);
}

export async function listPaymentNotificationExecutions(page: number, pageSize: number): Promise<ListPaymentNotificationExecutions> {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  let response: Response;
  try { response = await fetch(`${baseUrl}/automations/payment-notifications?${query}`); }
  catch { throw new PaymentNotificationApiError(0); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !isListResponse(body)) throw new PaymentNotificationApiError(response.status);
  return body;
}

// executionId is passed through exactly as received — never Number(executionId) — so a BIGINT
// beyond Number.MAX_SAFE_INTEGER is never silently truncated on its way to the API or back.
export async function getPaymentNotificationExecution(executionId: string): Promise<PaymentNotificationExecutionDetail> {
  let response: Response;
  try { response = await fetch(`${baseUrl}/automations/payment-notifications/${encodeURIComponent(executionId)}`, { cache: 'no-store' }); }
  catch { throw new PaymentNotificationApiError(0); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof body !== 'object' || body === null || !('data' in body) || !isExecutionDetail(body.data)) {
    throw new PaymentNotificationApiError(response.status);
  }
  return body.data;
}

// PN1.2 targeting fix §4: "Reprocesar" is per-execution — the caller passes the row's own public
// executionId (exactly as received — never Number(executionId), same convention as
// getPaymentNotificationExecution) in the path, and no request body. The server resolves that
// execution's internal correo_id itself; it is never sent by, or returned to, the browser.
export async function reprocessPaymentNotifications(executionId: string): Promise<void> {
  let response: Response;
  try { response = await fetch(`${baseUrl}/automations/payment-notifications/${encodeURIComponent(executionId)}/reprocess`, { method: 'POST' }); }
  catch { throw new PaymentNotificationApiError(0); }
  if (!response.ok) throw new PaymentNotificationApiError(response.status);
}
