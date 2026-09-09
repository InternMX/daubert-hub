import { apiBaseUrl as baseUrl } from './api';

export type AutomationEnvironment = 'TEST' | 'PRODUCTION' | 'UNKNOWN';
export type AutomationIntegrationStatus = 'INTEGRATED' | 'NOT_INTEGRATED';
export type AutomationLifecycleStatus = 'ACTIVE' | 'INACTIVE' | null;
export type AutomationProcessingOutcome = 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'PROCESSING' | 'CANCELLED' | null;

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
}

export class AutomationsOverviewApiError extends Error {
  constructor(public readonly status: number) {
    super('Automations overview API request failed');
  }
}

const environments = new Set<AutomationEnvironment>(['TEST', 'PRODUCTION', 'UNKNOWN']);
const integrationStatuses = new Set<AutomationIntegrationStatus>(['INTEGRATED', 'NOT_INTEGRATED']);
const processingOutcomes = new Set<Exclude<AutomationProcessingOutcome, null>>(['COMPLETED', 'PARTIAL', 'FAILED', 'PROCESSING', 'CANCELLED']);

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
    && isCapabilities(item.capabilities);
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
