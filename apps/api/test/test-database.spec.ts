import { describe, expect, it } from 'vitest';
import { assertTestDatabaseUrl } from '../src/database/test-database';

describe('test database guard', () => {
  it('accepts only daubert_hub_test', () => {
    expect(assertTestDatabaseUrl('postgres://test:password@localhost:5433/daubert_hub_test')).toContain('daubert_hub_test');
  });

  it.each(['postgres://test:password@localhost/daubert_global', 'postgres://test:password@localhost/postgres', 'postgres://test:password@localhost/daubert_global_restore_test'])('rejects non-test database %s', (connectionString) => {
    expect(() => assertTestDatabaseUrl(connectionString)).toThrow('Refusing database integration tests');
  });
});
