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
  details: CaterpillarRemittanceDetail[];
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
    && Array.isArray(item.details) && item.details.every(isRemittanceDetail);
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
