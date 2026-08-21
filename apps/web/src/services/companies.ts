import { apiBaseUrl } from './api';
import type { CompanyType } from './contactDirectory';
import { ProviderApiError } from './providers';

export interface CompanySearchResult {
  id: string;
  commercialName: string;
  companyType: CompanyType;
  legalName: string | null;
  rfc: string | null;
  matchedAlias: string | null;
}

export async function searchCompanies(search: string): Promise<CompanySearchResult[]> {
  let response: Response;
  try { response = await fetch(`${apiBaseUrl}/companies/search?${new URLSearchParams({ search })}`); } catch { throw new ProviderApiError(0, undefined, null); }
  const requestId = response.headers.get('x-request-id');
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof body !== 'object' || body === null || !('data' in body) || !Array.isArray(body.data)) {
    const code = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
    throw new ProviderApiError(response.status, code, requestId);
  }
  return body.data as CompanySearchResult[];
}
