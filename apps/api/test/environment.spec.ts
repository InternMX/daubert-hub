import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '../src/config/environment';

const valid = { DB_HOST: 'localhost', DB_PORT: '5432', DB_NAME: 'daubert_hub_test', DB_USER: 'test', DB_PASSWORD: 'secret' };

describe('validateEnvironment', () => {
  it('maps valid database configuration', () => {
    expect(validateEnvironment(valid)).toMatchObject({ apiPort: 3000, database: { port: 5432, name: 'daubert_hub_test' } });
  });

  it('rejects missing required values and malformed ports', () => {
    expect(() => validateEnvironment({ ...valid, DB_PASSWORD: '' })).toThrow('DB_PASSWORD');
    expect(() => validateEnvironment({ ...valid, DB_PORT: 'not-a-port' })).toThrow('DB_PORT');
  });

  it('defaults the auth cookie Secure flag to false and accepts explicit true/false', () => {
    expect(validateEnvironment(valid)).toMatchObject({ auth: { cookieSecure: false } });
    expect(validateEnvironment({ ...valid, AUTH_COOKIE_SECURE: 'true' })).toMatchObject({ auth: { cookieSecure: true } });
    expect(validateEnvironment({ ...valid, AUTH_COOKIE_SECURE: 'false' })).toMatchObject({ auth: { cookieSecure: false } });
  });

  it('rejects a non-boolean-literal AUTH_COOKIE_SECURE value', () => {
    expect(() => validateEnvironment({ ...valid, AUTH_COOKIE_SECURE: 'yes' })).toThrow('AUTH_COOKIE_SECURE');
  });
});
