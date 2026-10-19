import { apiBaseUrl } from './api';
import type { OtherCompanyAliasType } from './providers';

export interface CompanyAliasesData {
  aliases: string[];
  otherAliases: Array<{ alias: string; type: OtherCompanyAliasType }>;
}

export class CompanyAliasApiError extends Error {
  constructor(public readonly status: number, public readonly code: string | undefined, public readonly requestId: string | null) {
    super('Company alias API request failed');
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<{ data: T; requestId: string | null }> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, init);
  } catch {
    throw new CompanyAliasApiError(0, undefined, null);
  }
  const requestId = response.headers.get('x-request-id');
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof body !== 'object' || body === null || !('data' in body)) {
    const code = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
    throw new CompanyAliasApiError(response.status, code, requestId);
  }
  return { data: body.data as T, requestId };
}

export async function getCompanyAliases(companyId: string): Promise<CompanyAliasesData> {
  return (await request<CompanyAliasesData>(`/companies/${encodeURIComponent(companyId)}/aliases`)).data;
}

export interface PermanentAliasAssignment {
  companyId: string;
  companyName: string;
  alias: string;
  normalizedAlias: string;
  alreadyAssigned: boolean;
}

export async function assignPaymentAlias(companyId: string, alias: string, confirmPermanent: boolean): Promise<PermanentAliasAssignment> {
  return (await request<PermanentAliasAssignment>(`/companies/${encodeURIComponent(companyId)}/aliases/payment-notifications`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ alias, confirmPermanent })
  })).data;
}

export async function updateCompanyAliases(companyId: string, aliases: string[]): Promise<{ aliases: CompanyAliasesData; requestId: string | null }> {
  const result = await request<CompanyAliasesData>(`/companies/${encodeURIComponent(companyId)}/aliases`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ aliases }) });
  return { aliases: result.data, requestId: result.requestId };
}
