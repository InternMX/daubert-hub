export function resolveApiBaseUrl(value: string | undefined = import.meta.env.VITE_API_BASE_URL): string {
  const configured = value?.trim();
  if (!configured || configured === 'undefined' || configured === 'null') return '/api';
  return configured.replace(/\/+$/, '') || '/api';
}

export const apiBaseUrl = resolveApiBaseUrl();
