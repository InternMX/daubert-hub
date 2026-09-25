import { apiBaseUrl } from './api';

// The mapping (type -> folder) and the name normalization live in the API; this only asks for the
// result. Nothing is persisted: the user confirms the path by saving the provider form.
export type SuggestibleCompanyType = 'PROVEEDOR' | 'SERVICIO' | 'FLETE' | 'CLIENTE';

// Resolves to the suggested relative path, or null when the API has nothing safe to suggest. Rejects on
// any transport/contract failure; callers treat a rejection as "no suggestion".
export async function getDropboxPathSuggestion(companyType: SuggestibleCompanyType, commercialName: string, signal?: AbortSignal): Promise<string | null> {
  const query = new URLSearchParams({ companyType, commercialName });
  const response = await fetch(`${apiBaseUrl}/companies/dropbox-path-suggestion?${query}`, { signal });
  const body: unknown = await response.json().catch(() => null);
  const data = typeof body === 'object' && body !== null && 'data' in body ? (body as { data: unknown }).data : null;
  const suggestion = typeof data === 'object' && data !== null && 'suggestedDropboxPath' in data ? (data as { suggestedDropboxPath: unknown }).suggestedDropboxPath : undefined;
  if (!response.ok || (suggestion !== null && typeof suggestion !== 'string')) throw new Error('Dropbox path suggestion request failed');
  return suggestion;
}
