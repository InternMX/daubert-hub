import { apiBaseUrl as baseUrl } from './api';

export type AutomationEnvironment = 'TEST' | 'PRODUCTION' | 'UNKNOWN';
export type AutomationIntegrationStatus = 'INTEGRATED' | 'NOT_INTEGRATED';
export type AutomationLifecycleStatus = 'ACTIVE' | 'INACTIVE' | null;
export type AutomationProcessingOutcome = 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'PROCESSING' | 'CANCELLED' | null;
export type AutomationReviewOutcome = 'PARTIAL' | 'FAILED' | 'CANCELLED' | null;

// Human-review acknowledgement state (Phase 10I). Backend-authoritative and separate from
// lastProcessing — required=true can coexist with lastProcessing.outcome=COMPLETED when an
// earlier problem has not been acknowledged yet. Never re-derive `required` on the frontend.
export interface AutomationReview {
  required: boolean;
  problemOccurredAt: string | null;
  problemOutcome: AutomationReviewOutcome;
}

export interface AutomationOverview {
  code: string;
  name: string;
  description: string;
  integrationStatus: AutomationIntegrationStatus;
  environment: AutomationEnvironment;
  lifecycleStatus: AutomationLifecycleStatus;
  polling: { intervalMinutes: number; label: string };
  lastCheckAt: string | null;
  lastProcessing: { occurredAt: string; outcome: AutomationProcessingOutcome } | null;
  nextCheckAt: string | null;
  capabilities: { hasDashboard: boolean; hasHistory: boolean; hasDetail: boolean };
  review: AutomationReview;
}

export interface AcknowledgeAutomationReviewResponse {
  automationCode: string;
  reviewRequired: boolean;
  reviewedAt: string | null;
  reviewedBy: { displayName: string; email: string } | null;
}

export class AutomationsOverviewApiError extends Error {
  constructor(public readonly status: number) {
    super('Automations overview API request failed');
  }
}

const environments = new Set<AutomationEnvironment>(['TEST', 'PRODUCTION', 'UNKNOWN']);
const integrationStatuses = new Set<AutomationIntegrationStatus>(['INTEGRATED', 'NOT_INTEGRATED']);
const processingOutcomes = new Set<Exclude<AutomationProcessingOutcome, null>>(['COMPLETED', 'PARTIAL', 'FAILED', 'PROCESSING', 'CANCELLED']);
const reviewOutcomes = new Set<Exclude<AutomationReviewOutcome, null>>(['PARTIAL', 'FAILED', 'CANCELLED']);

function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime());
}

function isNullableIsoDateString(value: unknown): value is string | null {
  return value === null || isIsoDateString(value);
}

function isLifecycleStatus(value: unknown): value is AutomationLifecycleStatus {
  return value === null || value === 'ACTIVE' || value === 'INACTIVE';
}

function isProcessingOutcome(value: unknown): value is AutomationProcessingOutcome {
  return value === null || (typeof value === 'string' && processingOutcomes.has(value as Exclude<AutomationProcessingOutcome, null>));
}

// A positive, finite integer — never a coerced/rounded value from a malformed API response.
function isPositiveFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function isPolling(value: unknown): value is AutomationOverview['polling'] {
  if (typeof value !== 'object' || value === null) return false;
  const polling = value as Record<string, unknown>;
  return isPositiveFiniteInteger(polling.intervalMinutes) && typeof polling.label === 'string' && polling.label.length > 0;
}

function isLastProcessing(value: unknown): value is AutomationOverview['lastProcessing'] {
  if (value === null) return true;
  if (typeof value !== 'object') return false;
  const lastProcessing = value as Record<string, unknown>;
  return isIsoDateString(lastProcessing.occurredAt) && isProcessingOutcome(lastProcessing.outcome);
}

function isCapabilities(value: unknown): value is AutomationOverview['capabilities'] {
  if (typeof value !== 'object' || value === null) return false;
  const capabilities = value as Record<string, unknown>;
  return typeof capabilities.hasDashboard === 'boolean' && typeof capabilities.hasHistory === 'boolean' && typeof capabilities.hasDetail === 'boolean';
}

function isReviewOutcome(value: unknown): value is AutomationReviewOutcome {
  return value === null || (typeof value === 'string' && reviewOutcomes.has(value as Exclude<AutomationReviewOutcome, null>));
}

// Deliberately validates only `required`/`problemOccurredAt`/`problemOutcome` — technical source
// identifiers (source_reference, ejecucion_id, correo_id) must never be part of this contract, so
// there is nothing here to validate for them (Phase 10I §14).
function isReview(value: unknown): value is AutomationReview {
  if (typeof value !== 'object' || value === null) return false;
  const review = value as Record<string, unknown>;
  return typeof review.required === 'boolean' && isNullableIsoDateString(review.problemOccurredAt) && isReviewOutcome(review.problemOutcome);
}

function isAutomationOverview(value: unknown): value is AutomationOverview {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.code === 'string' && item.code.length > 0
    && typeof item.name === 'string' && item.name.length > 0
    && typeof item.description === 'string'
    && typeof item.integrationStatus === 'string' && integrationStatuses.has(item.integrationStatus as AutomationIntegrationStatus)
    && typeof item.environment === 'string' && environments.has(item.environment as AutomationEnvironment)
    && isLifecycleStatus(item.lifecycleStatus)
    && isPolling(item.polling)
    && isNullableIsoDateString(item.lastCheckAt)
    && isLastProcessing(item.lastProcessing)
    && isNullableIsoDateString(item.nextCheckAt)
    && isCapabilities(item.capabilities)
    && isReview(item.review);
}

export async function listAutomationsOverview(): Promise<AutomationOverview[]> {
  let response: Response;
  try { response = await fetch(`${baseUrl}/automations/overview`); }
  catch { throw new AutomationsOverviewApiError(0); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof body !== 'object' || body === null || !('data' in body) || !Array.isArray(body.data) || !body.data.every(isAutomationOverview)) {
    throw new AutomationsOverviewApiError(response.status);
  }
  return body.data;
}

function isAcknowledgeReviewedBy(value: unknown): value is AcknowledgeAutomationReviewResponse['reviewedBy'] {
  if (value === null) return true;
  if (typeof value !== 'object') return false;
  const reviewedBy = value as Record<string, unknown>;
  return typeof reviewedBy.displayName === 'string' && typeof reviewedBy.email === 'string';
}

function isAcknowledgeAutomationReviewResponse(value: unknown): value is AcknowledgeAutomationReviewResponse {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.automationCode === 'string' && item.automationCode.length > 0
    && typeof item.reviewRequired === 'boolean'
    && isNullableIsoDateString(item.reviewedAt)
    && isAcknowledgeReviewedBy(item.reviewedBy);
}

// The browser never sends a source/incident ID: the server resolves the current outstanding
// problem itself (Phase 10I §11) — this call carries no request body.
export async function acknowledgeAutomationReview(automationCode: string): Promise<AcknowledgeAutomationReviewResponse> {
  let response: Response;
  try { response = await fetch(`${baseUrl}/automations/${encodeURIComponent(automationCode)}/review-acknowledgements`, { method: 'POST' }); }
  catch { throw new AutomationsOverviewApiError(0); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof body !== 'object' || body === null || !('automationCode' in body) || !isAcknowledgeAutomationReviewResponse(body)) {
    throw new AutomationsOverviewApiError(response.status);
  }
  return body;
}
