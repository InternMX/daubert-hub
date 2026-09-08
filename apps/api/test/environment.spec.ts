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

  describe('app version/commit build metadata', () => {
    it('defaults to the known application version and "unknown" commit when neither env var is set', () => {
      expect(validateEnvironment(valid)).toMatchObject({ app: { version: '0.8.0-pilot.1', commit: 'unknown' } });
    });

    it('uses APP_VERSION and GIT_COMMIT when provided', () => {
      expect(validateEnvironment({ ...valid, APP_VERSION: '0.9.0-pilot.2', GIT_COMMIT: 'a1b2c3d' })).toMatchObject({
        app: { version: '0.9.0-pilot.2', commit: 'a1b2c3d' }
      });
    });

    it('trims surrounding whitespace and treats an empty/whitespace-only value as unset', () => {
      expect(validateEnvironment({ ...valid, APP_VERSION: '  1.0.0  ', GIT_COMMIT: '  abc1234  ' })).toMatchObject({
        app: { version: '1.0.0', commit: 'abc1234' }
      });
      expect(validateEnvironment({ ...valid, APP_VERSION: '   ', GIT_COMMIT: '   ' })).toMatchObject({
        app: { version: '0.8.0-pilot.1', commit: 'unknown' }
      });
    });

    it('never fails validation solely because commit metadata is unavailable', () => {
      expect(() => validateEnvironment(valid)).not.toThrow();
    });
  });
});
