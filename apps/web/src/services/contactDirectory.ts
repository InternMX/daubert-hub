import { apiBaseUrl } from './api';
import { ProviderApiError } from './providers';

export type CompanyType = 'PROVEEDOR' | 'SERVICIO' | 'FLETE' | 'CLIENTE' | 'OTRO';
export type ContactMethodType = 'CORREO' | 'TELEFONO' | 'WHATSAPP' | 'OTRO';
export type DirectoryContactType = 'PERSONA' | 'AREA' | 'BUZON_GENERICO';
export interface DirectoryCompany { id: string; commercialName: string; companyType: CompanyType; contactCount: number; matchedAlias?: string | null; }
export interface DirectoryContactMethod { id: string; type: ContactMethodType; value: string; isPrimary: boolean; }
export interface DirectoryContact { id: string; name: string | null; contactType: DirectoryContactType; area: string | null; position: string | null; notes: string | null; isPrimary: boolean; methods: DirectoryContactMethod[]; inactiveMethods: DirectoryContactMethod[]; }
export interface DirectoryCompanyDetail { company: Omit<DirectoryCompany, 'contactCount' | 'matchedAlias'>; contacts: DirectoryContact[]; }
export interface DirectoryList { data: DirectoryCompany[]; meta: { page: number; pageSize: number; total: number; totalPages: number }; }

async function request<T>(path: string): Promise<T> {
  let response: Response;
  try { response = await fetch(`${apiBaseUrl}${path}`); } catch { throw new ProviderApiError(0, undefined, null); }
  const requestId = response.headers.get('x-request-id');
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof body !== 'object' || body === null) {
    const code = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
    throw new ProviderApiError(response.status, code, requestId);
  }
  return body as T;
}
export function listContactDirectoryCompanies(input: { search?: string; page: number; pageSize: number }): Promise<DirectoryList> {
  const query = new URLSearchParams({ page: String(input.page), pageSize: String(input.pageSize) });
  if (input.search) query.set('search', input.search);
  return request<DirectoryList>(`/contact-directory/companies?${query}`);
}
export async function getContactDirectoryCompany(id: string): Promise<DirectoryCompanyDetail> { return (await request<{ data: DirectoryCompanyDetail }>(`/contact-directory/companies/${encodeURIComponent(id)}`)).data; }
