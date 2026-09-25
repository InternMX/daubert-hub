import { apiBaseUrl } from './api';

// Company-level Payment Notifications configuration. Everything here comes from the backend, which is
// the single source of truth for readiness: the UI renders `readiness` and never recomputes it.
export type PaymentNotificationMissingRequirement = 'DROPBOX_PATH_REQUIRED' | 'PAYMENT_PROCESSING_REQUIRED' | 'PAYMENT_RECIPIENT_PARA_REQUIRED';

export interface PaymentNotificationSettings {
  companyId: string;
  dropboxPath: string | null;
  processesPaymentReceipts: boolean;
  notificationsActive: boolean;
  destinationPath: string | null;
  readiness: { ready: boolean; missingRequirements: PaymentNotificationMissingRequirement[] };
}

export interface UpdatePaymentNotificationSettingsInput {
  processesPaymentReceipts?: boolean;
  notificationsActive?: boolean;
}

export class PaymentNotificationSettingsApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    public readonly requestId: string | null,
    // Requirement codes returned with PAYMENT_NOTIFICATIONS_NOT_READY (409). Empty otherwise.
    public readonly missingRequirements: string[] = []
  ) {
    super('Payment notification settings API request failed');
  }
}

const requirementCodes = new Set<string>(['DROPBOX_PATH_REQUIRED', 'PAYMENT_PROCESSING_REQUIRED', 'PAYMENT_RECIPIENT_PARA_REQUIRED']);

function isSettings(value: unknown): value is PaymentNotificationSettings {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  const readiness = item.readiness as Record<string, unknown> | null | undefined;
  return typeof item.companyId === 'string' && item.companyId.length > 0
    && (item.dropboxPath === null || typeof item.dropboxPath === 'string')
    && typeof item.processesPaymentReceipts === 'boolean'
    && typeof item.notificationsActive === 'boolean'
    && (item.destinationPath === null || typeof item.destinationPath === 'string')
    && typeof readiness === 'object' && readiness !== null
    && typeof readiness.ready === 'boolean'
    && Array.isArray(readiness.missingRequirements) && readiness.missingRequirements.every((code) => typeof code === 'string' && requirementCodes.has(code));
}

async function call(path: string, init?: RequestInit): Promise<PaymentNotificationSettings> {
  let response: Response;
  try { response = await fetch(`${apiBaseUrl}${path}`, init); } catch { throw new PaymentNotificationSettingsApiError(0, undefined, null); }
  const requestId = response.headers.get('x-request-id');
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
    const code = typeof record.code === 'string' ? record.code : undefined;
    const missing = Array.isArray(record.missingRequirements) ? record.missingRequirements.filter((item): item is string => typeof item === 'string') : [];
    throw new PaymentNotificationSettingsApiError(response.status, code, requestId, missing);
  }
  const data = typeof body === 'object' && body !== null && 'data' in body ? (body as { data: unknown }).data : null;
  if (!isSettings(data)) throw new PaymentNotificationSettingsApiError(response.status, undefined, requestId);
  return data;
}

// companyId is passed through as the string it arrived as (BIGINT-safe: never Number()).
export function getPaymentNotificationSettings(companyId: string): Promise<PaymentNotificationSettings> {
  return call(`/companies/${encodeURIComponent(companyId)}/payment-notification-settings`);
}

export function updatePaymentNotificationSettings(companyId: string, input: UpdatePaymentNotificationSettingsInput): Promise<PaymentNotificationSettings> {
  return call(`/companies/${encodeURIComponent(companyId)}/payment-notification-settings`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
}
