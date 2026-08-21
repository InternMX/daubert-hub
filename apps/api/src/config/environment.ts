export interface EnvironmentConfig {
  apiPort: number;
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
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

export function validateEnvironment(env: Record<string, string | undefined>): EnvironmentConfig {
  return {
    apiPort: port(env.API_PORT, 'API_PORT', 3000),
    database: {
      host: required(env.DB_HOST, 'DB_HOST'),
      port: port(env.DB_PORT, 'DB_PORT'),
      name: required(env.DB_NAME, 'DB_NAME'),
      user: required(env.DB_USER, 'DB_USER'),
      password: required(env.DB_PASSWORD, 'DB_PASSWORD')
    }
  };
}
