export interface EnvironmentConfig {
  apiPort: number;
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
  };
  auth: {
    // Explicit, validated configuration rather than inferring from
    // request headers (X-Forwarded-Proto etc, which a caller can spoof).
    // false for local HTTP dev/TEST; true once deployed behind HTTPS.
    cookieSecure: boolean;
  };
  app: {
    // Semantic application version — safe, non-secret build metadata
    // exposed via GET /api/health. Never derived from commit count.
    version: string;
    // Short Git commit SHA (e.g. "a1b2c3d"), or "unknown" when unavailable
    // (always true for an ad-hoc workspace API launch, and never fatal).
    commit: string;
  };
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function port(value: string | undefined, name: string, fallback?: number): number {
  const raw = value ?? (fallback === undefined ? undefined : String(fallback));
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Environment variable ${name} must be an integer between 1 and 65535`);
  }
  return parsed;
}

function booleanFlag(value: string | undefined, name: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Environment variable ${name} must be exactly "true" or "false"`);
}

// Last-resort default, used only when APP_VERSION isn't supplied by the
// environment. Docker (see docker/api.Dockerfile + compose.pilot.yaml) and
// `npm run dev`/`npm run dev:test` (see scripts/dev-test-only.cjs, which
// reads the root package.json directly) both supply it explicitly — this
// constant only matters for a direct workspace dev command or an ad-hoc process
// launch that skips both. Keep it in sync with the root package.json
// "version" field when bumping releases; this is intentionally the one
// place that small duplication is accepted, in exchange for the app version
// never failing to resolve to *something* meaningful.
const DEFAULT_APP_VERSION = '0.8.0-pilot.1';
const UNKNOWN_BUILD_METADATA = 'unknown';

export function validateEnvironment(env: Record<string, string | undefined>): EnvironmentConfig {
  return {
    apiPort: port(env.API_PORT, 'API_PORT', 3000),
    database: {
      host: required(env.DB_HOST, 'DB_HOST'),
      port: port(env.DB_PORT, 'DB_PORT'),
      name: required(env.DB_NAME, 'DB_NAME'),
      user: required(env.DB_USER, 'DB_USER'),
      password: required(env.DB_PASSWORD, 'DB_PASSWORD')
    },
    auth: {
      cookieSecure: booleanFlag(env.AUTH_COOKIE_SECURE, 'AUTH_COOKIE_SECURE', false)
    },
    app: {
      version: env.APP_VERSION?.trim() || DEFAULT_APP_VERSION,
      commit: env.GIT_COMMIT?.trim() || UNKNOWN_BUILD_METADATA
    }
  };
}
