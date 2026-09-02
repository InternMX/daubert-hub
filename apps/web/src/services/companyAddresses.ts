import { apiBaseUrl } from './api';

export type CompanyAddressType = 'FISCAL' | 'COMERCIAL' | 'OPERATIVA' | 'ENTREGA' | 'FACTURACION' | 'OTRA';
export type CompanyAddressStatus = 'ACTIVA' | 'INACTIVA';

export interface CompanyAddressInput {
  tipoDireccion: CompanyAddressType;
  calle: string | null;
  numeroExterior: string | null;
  numeroInterior: string | null;
  colonia: string | null;
  codigoPostal: string | null;
  municipio: string | null;
  estado: string | null;
  pais: string | null;
  direccionCompleta: string | null;
  referencias: string | null;
  esPrincipal: boolean;
  fechaInicio: string | null;
  fechaFin: string | null;
}

export type CreateCompanyAddressInput = CompanyAddressInput;
export type UpdateCompanyAddressInput = Partial<CompanyAddressInput>;

export interface CompanyAddress extends CompanyAddressInput {
  id: string;
  companyId: string;
  estatus: CompanyAddressStatus;
}

export class CompanyAddressApiError extends Error {
  constructor(public readonly status: number, public readonly code: string | undefined, public readonly requestId: string | null) {
    super('Company address API request failed');
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<{ data: T; requestId: string | null }> {
  let response: Response;
  try { response = await fetch(`${apiBaseUrl}${path}`, init); }
  catch { throw new CompanyAddressApiError(0, undefined, null); }
  const requestId = response.headers.get('x-request-id');
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof body !== 'object' || body === null || !('data' in body)) {
    const code = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
    throw new CompanyAddressApiError(response.status, code, requestId);
  }
  return { data: body.data as T, requestId };
}

export async function listCompanyAddresses(companyId: string): Promise<CompanyAddress[]> {
  return (await request<CompanyAddress[]>(`/companies/${encodeURIComponent(companyId)}/addresses`)).data;
}

export async function createCompanyAddress(companyId: string, input: CreateCompanyAddressInput): Promise<{ address: CompanyAddress; requestId: string | null }> {
  const result = await request<CompanyAddress>(`/companies/${encodeURIComponent(companyId)}/addresses`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  return { address: result.data, requestId: result.requestId };
}

export async function updateCompanyAddress(id: string, input: UpdateCompanyAddressInput): Promise<{ address: CompanyAddress; requestId: string | null }> {
  const result = await request<CompanyAddress>(`/addresses/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  return { address: result.data, requestId: result.requestId };
}

async function changeStatus(id: string, action: 'deactivate' | 'reactivate'): Promise<CompanyAddress> {
  return (await request<CompanyAddress>(`/addresses/${encodeURIComponent(id)}/${action}`, { method: 'POST' })).data;
}

export function deactivateCompanyAddress(id: string): Promise<CompanyAddress> { return changeStatus(id, 'deactivate'); }
export function reactivateCompanyAddress(id: string): Promise<CompanyAddress> { return changeStatus(id, 'reactivate'); }
