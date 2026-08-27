export type ProviderType = 'PROVEEDOR' | 'SERVICIO' | 'FLETE';
export type ProviderSortBy = 'commercialName' | 'providerType' | 'legalName';
export type SortOrder = 'asc' | 'desc';
export type ProviderStatus = 'ACTIVO' | 'INACTIVO' | 'ALL';

export interface CreateProviderInput {
  commercialName: string;
  providerType: ProviderType;
  fiscal: { legalName: string; rfc: string } | null;
  notes: string | null;
}

export interface CreatedProvider {
  id: string;
  commercialName: string;
  providerType: ProviderType;
  status: string;
  notes: string | null;
  fiscal: { id: string; legalName: string; rfc: string } | null;
}

export interface ListedProvider extends CreatedProvider { matchedAlias?: string | null; }

export interface ProviderDetail extends CreatedProvider {
  roles: string[];
  aliases: string[];
  otherAliases: Array<{ alias: string; type: OtherCompanyAliasType }>;
}

export type OtherCompanyAliasType = 'ABREVIATURA' | 'RAZON_SOCIAL' | 'RAZON_SOCIAL_HISTORICA' | 'NOMBRE_ARCHIVO' | 'NOMBRE_CARPETA' | 'OTRO';

export type FiscalChangeMode = 'CORRECTION' | 'NEW_IDENTITY';
export interface UpdateProviderInput {
  commercialName: string;
  providerType: ProviderType;
  notes: string | null;
  aliases: string[];
  fiscal: { legalName: string; rfc: string; changeMode?: FiscalChangeMode; effectiveStartDate?: string };
}

export interface ListProvidersInput {
  search?: string;
  providerType?: ProviderType;
  status?: ProviderStatus;
  sortBy: ProviderSortBy;
  sortOrder: SortOrder;
  page: number;
  pageSize: number;
}

export interface ListedProviders {
  data: ListedProvider[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export class ProviderApiError extends Error {
  constructor(public readonly status: number, public readonly code: string | undefined, public readonly requestId: string | null) {
    super('Provider API request failed');
  }
}

export { resolveApiBaseUrl } from './api';
import { apiBaseUrl as baseUrl } from './api';

export async function createProvider(input: CreateProviderInput): Promise<{ provider: CreatedProvider; requestId: string | null }> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input)
    });
  } catch {
    throw new ProviderApiError(0, undefined, null);
  }

  const requestId = response.headers.get('x-request-id');
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
    throw new ProviderApiError(response.status, code, requestId);
  }
  if (typeof body !== 'object' || body === null || !('data' in body)) {
    throw new ProviderApiError(response.status, undefined, requestId);
  }
  return { provider: body.data as CreatedProvider, requestId };
}

export async function listProviders(input: ListProvidersInput): Promise<ListedProviders> {
  const query = new URLSearchParams({ page: String(input.page), pageSize: String(input.pageSize) });
  if (input.search) query.set('search', input.search);
  if (input.providerType) query.set('providerType', input.providerType);
  if (input.status && input.status !== 'ACTIVO') query.set('status', input.status);
  if (input.sortBy !== 'commercialName') query.set('sortBy', input.sortBy);
  if (input.sortOrder !== 'asc') query.set('sortOrder', input.sortOrder);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/providers?${query}`);
  } catch {
    throw new ProviderApiError(0, undefined, null);
  }

  const requestId = response.headers.get('x-request-id');
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof body !== 'object' || body === null || !('data' in body) || !('meta' in body)) {
    throw new ProviderApiError(response.status, undefined, requestId);
  }
  return body as ListedProviders;
}

export async function getProvider(id: string): Promise<ProviderDetail> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/providers/${encodeURIComponent(id)}`);
  } catch {
    throw new ProviderApiError(0, undefined, null);
  }

  const requestId = response.headers.get('x-request-id');
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
    throw new ProviderApiError(response.status, code, requestId);
  }
  if (typeof body !== 'object' || body === null || !('data' in body)) {
    throw new ProviderApiError(response.status, undefined, requestId);
  }
  return body.data as ProviderDetail;
}

export async function updateProvider(id: string, input: UpdateProviderInput): Promise<{ provider: ProviderDetail; requestId: string | null }> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/providers/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  } catch {
    throw new ProviderApiError(0, undefined, null);
  }
  const requestId = response.headers.get('x-request-id');
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
    throw new ProviderApiError(response.status, code, requestId);
  }
  if (typeof body !== 'object' || body === null || !('data' in body)) throw new ProviderApiError(response.status, undefined, requestId);
  return { provider: body.data as ProviderDetail, requestId };
}

async function changeProviderStatus(id: string, action: 'deactivate' | 'reactivate'): Promise<{ provider: ProviderDetail; requestId: string | null }> {
  let response: Response;
  try { response = await fetch(`${baseUrl}/providers/${encodeURIComponent(id)}/${action}`, { method: 'POST' }); } catch { throw new ProviderApiError(0, undefined, null); }
  const requestId = response.headers.get('x-request-id');
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
    throw new ProviderApiError(response.status, code, requestId);
  }
  if (typeof body !== 'object' || body === null || !('data' in body)) throw new ProviderApiError(response.status, undefined, requestId);
  return { provider: body.data as ProviderDetail, requestId };
}

export function deactivateProvider(id: string) { return changeProviderStatus(id, 'deactivate'); }
export function reactivateProvider(id: string) { return changeProviderStatus(id, 'reactivate'); }
