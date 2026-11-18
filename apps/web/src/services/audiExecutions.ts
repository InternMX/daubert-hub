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
  constructor(public readonly status: number, public readonly code?: string) {
    super('Audi executions API request failed');
  }
}

const recoveryActions = ['REPROCESS', 'RECONCILE', 'STOP', 'CANCEL'] as const;
export type AudiRecoveryAction = typeof recoveryActions[number];

interface AudiRecoveryArtifact {
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

interface AudiRecoveryAttempt {
  actionId: string;
  action: AudiRecoveryAction;
  status: 'EN_CURSO' | 'COMPLETADA' | 'FALLIDA' | 'EXPIRADA';
  resultCode: string | null;
  reason: string;
  actorName: string | null;
  createdAt: string;
  lastHeartbeatAt: string | null;
  expiresAt: string;
  finishedAt: string | null;
  error: string | null;
}

export interface AudiExecutionDetail {
  executionId: string;
  outcome: AudiProcessingOutcome;
  startedAt: string;
  finishedAt: string | null;
  generatedCount: number;
  sourceDocument: { documentId: string; filename: string | null } | null;
  latestErrorMessage: string | null;
  n8nExecutionId?: string | null;
  reprocessOfExecutionId?: string | null;
  childExecutionId?: string | null;
  model?: 'LEGACY' | 'ATOMIC' | null;
  revision?: string | null;
  reservation?: { firstFolio: string; lastFolio: string; quantity: number; status: string } | null;
  artifacts?: AudiRecoveryArtifact[];
  recoveryAttempts?: AudiRecoveryAttempt[];
  availableActions?: { action: AudiRecoveryAction; enabled: boolean; disabledReason: string | null }[];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isRecoveryAction(value: unknown): value is AudiRecoveryAction {
  return recoveryActions.some((action) => action === value);
}

function isArtifact(value: unknown): boolean {
  return isRecord(value) && typeof value.type === 'string' && (value.folio === null || isBigintId(value.folio))
    && isNonNegativeFiniteInteger(value.version) && value.version > 0 && typeof value.current === 'boolean'
    && isText(value.fileName) && (value.sizeBytes === null || isNonNegativeFiniteInteger(value.sizeBytes))
    && isText(value.sha256) && typeof value.status === 'string' && isIsoDateString(value.verifiedAt)
    && (value.actionId === null || isBigintId(value.actionId));
}

function isAttempt(value: unknown): boolean {
  return isRecord(value) && isBigintId(value.actionId) && isRecoveryAction(value.action)
    && ['EN_CURSO', 'COMPLETADA', 'FALLIDA', 'EXPIRADA'].some((status) => status === value.status)
    && isText(value.resultCode) && typeof value.reason === 'string' && isText(value.actorName)
    && isIsoDateString(value.createdAt) && isIsoDateString(value.expiresAt)
    && (value.lastHeartbeatAt === null || isIsoDateString(value.lastHeartbeatAt))
    && (value.finishedAt === null || isIsoDateString(value.finishedAt)) && isText(value.error);
}

function isDetail(value: unknown): value is AudiExecutionDetail {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  const source = item.sourceDocument as Record<string, unknown> | null;
  return isBigintId(item.executionId)
    && typeof item.outcome === 'string' && outcomes.has(item.outcome as AudiProcessingOutcome)
    && isIsoDateString(item.startedAt) && (item.finishedAt === null || isIsoDateString(item.finishedAt))
    && isNonNegativeFiniteInteger(item.generatedCount)
    && (item.n8nExecutionId === undefined || isText(item.n8nExecutionId))
    && [item.reprocessOfExecutionId, item.childExecutionId].every((id) => id == null || isBigintId(id))
    && (item.model == null || item.model === 'LEGACY' || item.model === 'ATOMIC')
    && (item.revision === undefined || isText(item.revision))
    && (item.reservation == null || (isRecord(item.reservation) && isBigintId(item.reservation.firstFolio)
      && isBigintId(item.reservation.lastFolio) && isNonNegativeFiniteInteger(item.reservation.quantity)
      && typeof item.reservation.status === 'string'))
    && (item.artifacts === undefined || (Array.isArray(item.artifacts) && item.artifacts.every(isArtifact)))
    && (item.recoveryAttempts === undefined || (Array.isArray(item.recoveryAttempts) && item.recoveryAttempts.every(isAttempt)))
    && (item.availableActions === undefined || (Array.isArray(item.availableActions) && item.availableActions.every(
      (entry: unknown) => isRecord(entry) && isRecoveryAction(entry.action) && typeof entry.enabled === 'boolean' && isText(entry.disabledReason))))
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

export interface AudiRecoveryResult {
  accepted: boolean;
  status: string;
  actionId: string | null;
  executionId: string;
  childExecutionId?: string;
}

async function requestAudiRecovery(executionId: string, action: AudiRecoveryAction,
  payload: { reason: string; expectedRevision?: string | null }): Promise<AudiRecoveryResult> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/automations/remissions/audi/executions/${encodeURIComponent(executionId)}/${action.toLowerCase()}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch { throw new AudiExecutionsApiError(0); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = isRecord(body) && typeof body.code === 'string' ? body.code : undefined;
    throw new AudiExecutionsApiError(response.status, code);
  }
  const data = isRecord(body) ? body.data : null;
  if (!isRecord(data) || typeof data.accepted !== 'boolean' || typeof data.status !== 'string'
    || !isBigintId(data.executionId) || data.executionId !== executionId
    || (data.actionId !== null && !isBigintId(data.actionId))
    || (data.childExecutionId !== undefined && !isBigintId(data.childExecutionId))) {
    throw new AudiExecutionsApiError(response.status);
  }
  return { accepted: data.accepted, status: data.status, actionId: data.actionId, executionId: data.executionId,
    ...(data.childExecutionId ? { childExecutionId: data.childExecutionId } : {}) };
}

export const reprocessAudiExecution = (id: string, reason: string) => requestAudiRecovery(id, 'REPROCESS', { reason });
export const reconcileAudiExecution = (id: string, reason: string, expectedRevision: string | null) =>
  requestAudiRecovery(id, 'RECONCILE', { reason, expectedRevision });
export const stopAudiExecution = (id: string, reason: string) => requestAudiRecovery(id, 'STOP', { reason });
export const cancelAudiExecution = (id: string, reason: string, expectedRevision: string | null) =>
  requestAudiRecovery(id, 'CANCEL', { reason, expectedRevision });
