import { apiBaseUrl } from './api';
import type { FiscalChangeMode } from './providers';

export type SortOrder = 'asc' | 'desc';
export type ClientLifecycleStatus = 'ACTIVO' | 'INACTIVO';

export interface ClientFiscal {
  id: string;
  legalName: string;
  rfc: string;
  startDate: string | null;
  endDate: string | null;
}

export interface CreateClientInput {
  commercialName: string;
  fiscal: { legalName: string; rfc: string } | null;
  notes: string | null;
}

export interface ClientDetail {
  id: string;
  commercialName: string;
  companyType: string;
  status: string;
  // The company's own status. A company can hold other roles (e.g. PROVEEDOR) that stay
  // active independently of the CLIENTE role, so this is NOT the Client lifecycle signal —
  // use clientStatus for that.
  clientStatus: ClientLifecycleStatus;
  notes: string | null;
  roles: string[];
  fiscal: ClientFiscal | null;
}

export type ClientListItem = ClientDetail;
export type CreatedClient = ClientDetail;

export interface UpdateClientInput {
  commercialName?: string;
  notes?: string | null;
  fiscal?: { legalName: string; rfc: string; changeMode?: FiscalChangeMode; effectiveStartDate?: string };
}

export interface ListClientsInput {
  search?: string;
  sortOrder: SortOrder;
  page: number;
  pageSize: number;
}

export interface ListedClients {
  data: ClientListItem[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export class ClientApiError extends Error {
  constructor(public readonly status: number, public readonly code: string | undefined, public readonly requestId: string | null) {
    super('Client API request failed');
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<{ data: T; requestId: string | null }> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, init);
  } catch {
    throw new ClientApiError(0, undefined, null);
  }
  const requestId = response.headers.get('x-request-id');
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof body !== 'object' || body === null || !('data' in body)) {
    const code = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
    throw new ClientApiError(response.status, code, requestId);
  }
  return { data: body.data as T, requestId };
}

export async function createClient(input: CreateClientInput): Promise<{ client: CreatedClient; requestId: string | null }> {
  const result = await request<CreatedClient>('/clients', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  return { client: result.data, requestId: result.requestId };
}

export async function listClients(input: ListClientsInput): Promise<ListedClients> {
  const query = new URLSearchParams({ page: String(input.page), pageSize: String(input.pageSize) });
  if (input.search) query.set('search', input.search);
  if (input.sortOrder !== 'asc') query.set('sortOrder', input.sortOrder);

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/clients?${query}`);
  } catch {
    throw new ClientApiError(0, undefined, null);
  }

  const requestId = response.headers.get('x-request-id');
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof body !== 'object' || body === null || !('data' in body) || !('meta' in body)) {
    throw new ClientApiError(response.status, undefined, requestId);
  }
  return body as ListedClients;
}

export async function getClient(id: string): Promise<ClientDetail> {
  return (await request<ClientDetail>(`/clients/${encodeURIComponent(id)}`)).data;
}

export async function updateClient(id: string, input: UpdateClientInput): Promise<{ client: ClientDetail; requestId: string | null }> {
  const result = await request<ClientDetail>(`/clients/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  return { client: result.data, requestId: result.requestId };
}

async function changeClientStatus(id: string, action: 'deactivate' | 'reactivate'): Promise<{ client: ClientDetail; requestId: string | null }> {
  const result = await request<ClientDetail>(`/clients/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
  return { client: result.data, requestId: result.requestId };
}

export function deactivateClient(id: string) { return changeClientStatus(id, 'deactivate'); }
export function reactivateClient(id: string) { return changeClientStatus(id, 'reactivate'); }
