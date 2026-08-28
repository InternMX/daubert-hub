import { apiBaseUrl } from './api';

export type RuntimeEnvironment = 'PRODUCTION' | 'TEST' | 'UNKNOWN';

const runtimeEnvironments = new Set<RuntimeEnvironment>(['PRODUCTION', 'TEST', 'UNKNOWN']);

export async function getRuntimeEnvironment(): Promise<RuntimeEnvironment> {
  const response = await fetch(`${apiBaseUrl}/health`);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof body !== 'object' || body === null || !('environment' in body)) {
    throw new Error('HEALTH_UNAVAILABLE');
  }

  const environment = body.environment;
  if (typeof environment !== 'string' || !runtimeEnvironments.has(environment as RuntimeEnvironment)) {
    throw new Error('HEALTH_UNAVAILABLE');
  }
  return environment as RuntimeEnvironment;
}
