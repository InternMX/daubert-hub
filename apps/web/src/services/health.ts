import { apiBaseUrl } from './api';

export type RuntimeEnvironment = 'PRODUCTION' | 'TEST' | 'UNKNOWN';

const runtimeEnvironments = new Set<RuntimeEnvironment>(['PRODUCTION', 'TEST', 'UNKNOWN']);

export interface AppHealth {
  environment: RuntimeEnvironment;
  // Safe, non-secret build metadata from the backend (see GET /api/health).
  // null when the backend response doesn't carry a well-formed value —
  // callers must handle that (e.g. by simply not rendering a version).
  version: string | null;
  commit: string | null;
}

// Single source of truth for both the environment indicator and the
// version/commit shown in AppShell — one fetch to /api/health, not
// independently hardcoded in the frontend (see getRuntimeEnvironment below,
// which is now a thin wrapper kept for its existing call sites).
export async function getHealth(): Promise<AppHealth> {
  const response = await fetch(`${apiBaseUrl}/health`);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof body !== 'object' || body === null || !('environment' in body)) {
    throw new Error('HEALTH_UNAVAILABLE');
  }

  const environment = body.environment;
  if (typeof environment !== 'string' || !runtimeEnvironments.has(environment as RuntimeEnvironment)) {
    throw new Error('HEALTH_UNAVAILABLE');
  }

  const version = 'version' in body && typeof body.version === 'string' && body.version.trim() ? body.version : null;
  const commit = 'commit' in body && typeof body.commit === 'string' && body.commit.trim() ? body.commit : null;
  return { environment: environment as RuntimeEnvironment, version, commit };
}

export async function getRuntimeEnvironment(): Promise<RuntimeEnvironment> {
  return (await getHealth()).environment;
}
