import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
const load = createRequire(resolve(process.cwd(),'package.json'));
const { guardedUrl, markerFor, authorize, childEnvironment } = load('./test/support/caterpillar-cancellation-test-guards.cjs');
describe('Caterpillar E2E guards (pure, runner NOT executed)', () => {
  it.each(['postgres://postgres@localhost/daubert_global','postgres://postgres@localhost/daubert_hub_test?dbname=daubert_global',
    'postgres://postgres@localhost/daubert_hub_test?host=other','https://postgres@localhost/daubert_hub_test',
    'postgres://n8n_app@localhost/daubert_hub_test','postgres://postgres@localhost/daubert_hub_test/'])('rejects unsafe URL %s', (url) => {
    expect(() => guardedUrl(url,'postgres')).toThrow();
  });
  it('accepts only the explicit role/database and requires authorization before writes', () => {
    expect(guardedUrl('postgres://postgres@localhost/daubert_hub_test','postgres').pathname).toBe('/daubert_hub_test');
    for (const action of ['apply','e2e','cleanup']) expect(() => authorize(action,[])).toThrow();
    expect(() => authorize('apply',['--allow-test-writes'])).not.toThrow();
    expect(() => authorize('precheck',[])).not.toThrow();
  });
  it.each(['','14','../../other','%_','UPPERCASE'])('rejects unscoped cleanup run id %s', (id) => {
    expect(() => markerFor(id)).toThrow();
  });
  it('keeps secrets from parent process/admin/n8n out of the API child environment', () => {
    const result=childEnvironment({ PATH:'bin', TEST_DATABASE_URL_MIGRATOR:'do-not-forward', CATERPILLAR_REPROCESS_WEBHOOK_URL:'do-not-forward', OTHER_SECRET:'do-not-forward' },
      new URL('postgres://daubert_hub_test_user@localhost/daubert_hub_test'),3200);
    expect(result).not.toHaveProperty('TEST_DATABASE_URL_MIGRATOR');
    expect(result).not.toHaveProperty('OTHER_SECRET');
    expect(result.CATERPILLAR_REPROCESS_WEBHOOK_URL).toBe('');
  });
});
