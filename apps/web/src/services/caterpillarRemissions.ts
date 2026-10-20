import { apiBaseUrl as baseUrl } from './api';
import type { AudiProcessingOutcome } from './audiExecutions';

// Reuses Audi's outcome vocabulary rather than duplicating it — both automations' executions
// come from the same ops.ejecuciones_automatizacion.estado CHECK constraint on the backend
// (mapAudiExecutionState is shared server-side too, see caterpillar-executions.service.ts).
export type CaterpillarExecutionOutcome = AudiProcessingOutcome;

// ACTIVA/INACTIVA already translated server-side to this two-value vocabulary — applies
// independently to route status, series status, and (via automationsOverview) automation
// lifecycle status. Never collapsed into a single "active" flag (Phase 12A.4).
export type CaterpillarStatus = 'ACTIVE' | 'INACTIVE';

export interface CaterpillarProcessRoute {
  routeId: string;
  processKey: string;
  processLabel: string;
  routeStatus: CaterpillarStatus;
  seriesId: string;
  seriesCode: string;
  seriesStatus: CaterpillarStatus;
  nextFolio: number;
  clientCompanyId: string;
  clientCompanyName: string | null;
}

export interface ListCaterpillarSeries {
  data: CaterpillarProcessRoute[];
}

export interface CaterpillarExecutionSummary {
  executionId: string;
  outcome: CaterpillarExecutionOutcome;
  startedAt: string;
  finishedAt: string | null;
  failedAttempts: number;
  maxAttempts: number;
  latestErrorNode: string | null;
  latestErrorMessage: string | null;
  n8nExecutionId: string | null;
  sourceDocumentId: string;
  sourceFilename: string;
  generatedRemissionCount: number;
  minimumFolio: string | null;
  maximumFolio: string | null;
  // Backend-authoritative: null whenever the execution cannot be tied to exactly one route (e.g.
  // Torreón/Torreón Planta 2 sharing one serie_id) — never re-derived or guessed on the frontend
  // from series code, source path, filename, or Dropbox folder (Phase 12A.4 §B).
  processLabel: string | null;
}

export interface ListCaterpillarExecutions {
  data: CaterpillarExecutionSummary[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface CaterpillarSourceDocument {
  documentId: string;
  filename: string;
  path: string;
  hash: string | null;
  origin: string | null;
  documentDate: string | null;
}

export interface CaterpillarFolioReservation {
  reservationId: string;
  seriesId: string;
  seriesCode: string;
  folioInicial: string;
  folioFinal: string;
  quantity: number;
  status: string;
}

export interface CaterpillarRemittanceDetail {
  detailId: string;
  internalCode: string | null;
  partNumber: string | null;
  description: string | null;
  quantityText: string;
}

export interface CaterpillarRemittance {
  remissionId: string;
  seriesId: string;
  seriesCode: string;
  folio: string;
  documentDate: string;
  // Plain text only — never resolved to a filesystem path, URL, or Dropbox navigation target
  // (Phase 12A.4: no "Abrir PDF" yet).
  pdfPath: string | null;
  status: string;
  revision?: string | null;
  processLabel?: string | null;
  cancellationReason?: string | null;
  cancellation?: CaterpillarCancellation | null;
  details: CaterpillarRemittanceDetail[];
}

export interface CaterpillarCancellation {
  cancellationId: string;
  userId: string | null;
  userEmail: string;
  userDisplayName: string;
  cancelledAt: string;
  requestId: string | null;
}

export interface CaterpillarExecutionDetail {
  executionId: string;
  outcome: CaterpillarExecutionOutcome;
  startedAt: string;
  finishedAt: string | null;
  failedAttempts: number;
  maxAttempts: number;
  latestErrorNode: string | null;
  latestErrorMessage: string | null;
  n8nExecutionId: string | null;
  reprocessOfExecutionId: string | null;
  sourceDocument: CaterpillarSourceDocument;
  reservations: CaterpillarFolioReservation[];
  remittances: CaterpillarRemittance[];
}

export class CaterpillarApiError extends Error {
  constructor(public readonly status: number) {
    super('Caterpillar API request failed');
  }
}

const statuses = new Set<CaterpillarStatus>(['ACTIVE', 'INACTIVE']);
const outcomes = new Set<CaterpillarExecutionOutcome>(['COMPLETED', 'FAILED', 'PROCESSING', 'CANCELLED']);

function isStatus(value: unknown): value is CaterpillarStatus {
  return typeof value === 'string' && statuses.has(value as CaterpillarStatus);
}

function isOutcome(value: unknown): value is CaterpillarExecutionOutcome {
  return typeof value === 'string' && outcomes.has(value as CaterpillarExecutionOutcome);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNonNegativeFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime());
}

function isNullableIsoDateString(value: unknown): value is string | null {
  return value === null || isIsoDateString(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isProcessRoute(value: unknown): value is CaterpillarProcessRoute {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return isNonEmptyString(item.routeId)
    && isNonEmptyString(item.processKey)
    && isNonEmptyString(item.processLabel)
    && isStatus(item.routeStatus)
    && isNonEmptyString(item.seriesId)
    && isNonEmptyString(item.seriesCode)
    && isStatus(item.seriesStatus)
    && isNonNegativeFiniteInteger(item.nextFolio)
    && isNonEmptyString(item.clientCompanyId)
    && isNullableString(item.clientCompanyName);
}

function isListSeries(value: unknown): value is ListCaterpillarSeries {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  return Array.isArray(body.data) && body.data.every(isProcessRoute);
}

// BIGINT-safe fields (folio strings) are validated as strings only, never coerced through
// Number() — a folio beyond Number.MAX_SAFE_INTEGER must never be silently truncated.
function isExecutionSummary(value: unknown): value is CaterpillarExecutionSummary {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return isNonEmptyString(item.executionId)
    && isOutcome(item.outcome)
    && isIsoDateString(item.startedAt)
    && isNullableIsoDateString(item.finishedAt)
    && isNonNegativeFiniteInteger(item.failedAttempts)
    && isNonNegativeFiniteInteger(item.maxAttempts)
    && isNullableString(item.latestErrorNode)
    && isNullableString(item.latestErrorMessage)
    && isNullableString(item.n8nExecutionId)
    && isNonEmptyString(item.sourceDocumentId)
    && isNonEmptyString(item.sourceFilename)
    && isNonNegativeFiniteInteger(item.generatedRemissionCount)
    && isNullableString(item.minimumFolio)
    && isNullableString(item.maximumFolio)
    && isNullableString(item.processLabel);
}

function isMeta(value: unknown): value is ListCaterpillarExecutions['meta'] {
  if (typeof value !== 'object' || value === null) return false;
  const meta = value as Record<string, unknown>;
  return isNonNegativeFiniteInteger(meta.page) && meta.page >= 1
    && isNonNegativeFiniteInteger(meta.pageSize) && meta.pageSize >= 1
    && isNonNegativeFiniteInteger(meta.total)
    && isNonNegativeFiniteInteger(meta.totalPages);
}

function isListExecutions(value: unknown): value is ListCaterpillarExecutions {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  return Array.isArray(body.data) && body.data.every(isExecutionSummary) && isMeta(body.meta);
}

function isSourceDocument(value: unknown): value is CaterpillarSourceDocument {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return isNonEmptyString(item.documentId)
    && isNonEmptyString(item.filename)
    && isNonEmptyString(item.path)
    && isNullableString(item.hash)
    && isNullableString(item.origin)
    && isNullableIsoDateString(item.documentDate);
}

function isReservation(value: unknown): value is CaterpillarFolioReservation {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return isNonEmptyString(item.reservationId)
    && isNonEmptyString(item.seriesId)
    && isNonEmptyString(item.seriesCode)
    && isNonEmptyString(item.folioInicial)
    && isNonEmptyString(item.folioFinal)
    && isNonNegativeFiniteInteger(item.quantity)
    && isNonEmptyString(item.status);
}

function isRemittanceDetail(value: unknown): value is CaterpillarRemittanceDetail {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return isNonEmptyString(item.detailId)
    && isNullableString(item.internalCode)
    && isNullableString(item.partNumber)
    && isNullableString(item.description)
    && isNonEmptyString(item.quantityText);
}

function isRemittance(value: unknown): value is CaterpillarRemittance {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return isNonEmptyString(item.remissionId)
    && isNonEmptyString(item.seriesId)
    && isNonEmptyString(item.seriesCode)
    && isNonEmptyString(item.folio)
    && isIsoDateString(item.documentDate)
    && isNullableString(item.pdfPath)
    && isNonEmptyString(item.status)
    && (item.revision === undefined || item.revision === null || isRevision(item.revision))
    && (item.processLabel === undefined || isNullableString(item.processLabel))
    && (item.cancellationReason === undefined || isNullableString(item.cancellationReason))
    && (item.cancellation === undefined || item.cancellation === null || isCancellation(item.cancellation))
    && Array.isArray(item.details) && item.details.every(isRemittanceDetail);
}

function isRevision(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value);
}

function isCancellation(value: unknown): value is CaterpillarCancellation {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return isNonEmptyString(item.cancellationId) && isNullableString(item.userId)
    && isNonEmptyString(item.userEmail) && isNonEmptyString(item.userDisplayName)
    && isIsoDateString(item.cancelledAt) && isNullableString(item.requestId);
}

export class CaterpillarCancellationApiError extends Error {
  constructor(public readonly status: number) { super('Caterpillar cancellation request failed'); }
}

export interface CaterpillarCancelResult {
  status: 'CANCELLED' | 'ALREADY_CANCELLED';
  remissionId: string;
  cancellationReason: string | null;
  cancellation: CaterpillarCancellation | null;
}

export async function cancelCaterpillarRemission(executionId: string, remissionId: string, reason: string, expectedRevision: string): Promise<CaterpillarCancelResult> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/automations/remissions/caterpillar/executions/${encodeURIComponent(executionId)}/remittances/${encodeURIComponent(remissionId)}/cancel`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason, expectedRevision })
    });
  } catch { throw new CaterpillarCancellationApiError(0); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new CaterpillarCancellationApiError(response.status);
  const data = typeof body === 'object' && body !== null && 'data' in body ? body.data : null;
  if (typeof data !== 'object' || data === null || !('status' in data) || !('remissionId' in data)
    || !('cancellationReason' in data) || !('cancellation' in data)
    || typeof data.status !== 'string' || !['CANCELLED', 'ALREADY_CANCELLED'].includes(data.status) || data.remissionId !== remissionId
    || !isNullableString(data.cancellationReason) || (data.cancellation !== null && !isCancellation(data.cancellation))
    || (data.status === 'CANCELLED' && (data.cancellation === null || !isNonEmptyString(data.cancellationReason)))) {
    throw new CaterpillarCancellationApiError(response.status);
  }
  return { status: data.status as CaterpillarCancelResult['status'], remissionId, cancellationReason: data.cancellationReason,
    cancellation: data.cancellation as CaterpillarCancellation | null };
}

function isExecutionDetail(value: unknown): value is CaterpillarExecutionDetail {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return isNonEmptyString(item.executionId)
    && isOutcome(item.outcome)
    && isIsoDateString(item.startedAt)
    && isNullableIsoDateString(item.finishedAt)
    && isNonNegativeFiniteInteger(item.failedAttempts)
    && isNonNegativeFiniteInteger(item.maxAttempts)
    && isNullableString(item.latestErrorNode)
    && isNullableString(item.latestErrorMessage)
    && isNullableString(item.n8nExecutionId)
    && isNullableString(item.reprocessOfExecutionId)
    && isSourceDocument(item.sourceDocument)
    && Array.isArray(item.reservations) && item.reservations.every(isReservation)
    && Array.isArray(item.remittances) && item.remittances.every(isRemittance);
}

export async function listCaterpillarSeries(): Promise<ListCaterpillarSeries> {
  let response: Response;
  try { response = await fetch(`${baseUrl}/automations/remissions/caterpillar/series`); }
  catch { throw new CaterpillarApiError(0); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !isListSeries(body)) throw new CaterpillarApiError(response.status);
  return body;
}

export async function listCaterpillarExecutions(page: number, pageSize: number): Promise<ListCaterpillarExecutions> {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  let response: Response;
  try { response = await fetch(`${baseUrl}/automations/remissions/caterpillar/executions?${query}`); }
  catch { throw new CaterpillarApiError(0); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !isListExecutions(body)) throw new CaterpillarApiError(response.status);
  return body;
}

// executionId is passed through exactly as received — never Number(executionId) — so a BIGINT
// beyond Number.MAX_SAFE_INTEGER is never silently truncated on its way to the API or back.
export async function getCaterpillarExecution(executionId: string): Promise<CaterpillarExecutionDetail> {
  let response: Response;
  try { response = await fetch(`${baseUrl}/automations/remissions/caterpillar/executions/${encodeURIComponent(executionId)}`); }
  catch { throw new CaterpillarApiError(0); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof body !== 'object' || body === null || !('data' in body) || !isExecutionDetail(body.data)) {
    throw new CaterpillarApiError(response.status);
  }
  return body.data;
}

// Phase 12C: manual reprocess. Mirrors AutomationApiError's shape (status + the backend's own
// sanitized message) rather than the plain CaterpillarApiError above — the Hub's 409 responses
// carry three genuinely different domain reasons (NOT_ELIGIBLE_STATE/SOURCE_FILE_MISSING/
// OUTSIDE_TEST_SCOPE) as distinct, correctly-worded Spanish messages, and this displays those
// directly instead of a second hardcoded status->text table that could drift from the backend.
export class CaterpillarReprocessApiError extends Error {
  constructor(public readonly status: number, public readonly serverMessage: string | undefined = undefined) {
    super('Caterpillar reprocess request failed');
  }
}

export type CaterpillarReprocessStatus = 'REPROCESS_CREATED' | 'ALREADY_PROCESSING' | 'ALREADY_REPROCESSED';

export interface CaterpillarReprocessResult {
  originalExecutionId: string;
  executionId: string;
  status: CaterpillarReprocessStatus;
}

const reprocessStatuses = new Set<CaterpillarReprocessStatus>(['REPROCESS_CREATED', 'ALREADY_PROCESSING', 'ALREADY_REPROCESSED']);

// Mirrors only what the frontend actually needs to branch on — not a re-implementation of the
// Hub's own strict upstream-contract validation (that already happened server-side). Rejects
// arbitrary/malformed JSON rather than trusting it blindly, consistent with every other response
// parser in this file.
function isReprocessResult(value: unknown): value is CaterpillarReprocessResult {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return item.accepted === true
    && isNonEmptyString(item.originalExecutionId)
    && isNonEmptyString(item.executionId)
    && typeof item.status === 'string' && reprocessStatuses.has(item.status as CaterpillarReprocessStatus);
}

// The Hub never accepts (and this never sends) a file path, documento_origen_id, plant, series,
// or automation code from the browser — only executionId (in the path, exactly as received,
// never Number()) and reason. n8n/PostgreSQL resolve everything else server-side (Phase 12C).
export async function reprocessCaterpillarExecution(executionId: string, reason: string): Promise<CaterpillarReprocessResult> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/automations/remissions/caterpillar/executions/${encodeURIComponent(executionId)}/reprocess`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason })
    });
  } catch { throw new CaterpillarReprocessApiError(0); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : null;
    const message = record && typeof record.message === 'string' ? record.message : undefined;
    throw new CaterpillarReprocessApiError(response.status, message);
  }
  if (!isReprocessResult(body)) throw new CaterpillarReprocessApiError(response.status, undefined);
  // Only the fields this app actually uses — never the raw `accepted` envelope field or anything
  // else the Hub's response might carry.
  return { originalExecutionId: body.originalExecutionId, executionId: body.executionId, status: body.status };
}
