import { describe, expect, it } from 'vitest';
import { assertLiveDatabaseMatches } from '../src/config/live-database-guard';

describe('assertLiveDatabaseMatches', () => {
  it('allows startup when the live database matches the expected one', () => {
    expect(() => assertLiveDatabaseMatches('daubert_hub_test', 'daubert_hub_test')).not.toThrow();
  });

  it.each([
    ['daubert_global', 'daubert_hub_test'],
    ['some_other_db', 'daubert_hub_test'],
    [undefined, 'daubert_hub_test'],
    [null, 'daubert_hub_test']
  ])('rejects startup when the live database %s does not match expected %s', (actual, expected) => {
    expect(() => assertLiveDatabaseMatches(actual as never, expected)).toThrow('Refusing to start');
  });

  it('reports expected vs actual database names', () => {
    expect(() => assertLiveDatabaseMatches('daubert_global', 'daubert_hub_test')).toThrow('expected database "daubert_hub_test" but the live connection reports "daubert_global"');
  });

  it('never includes a connection string or credentials in the error', () => {
    try {
      assertLiveDatabaseMatches('daubert_global', 'daubert_hub_test');
      throw new Error('expected assertLiveDatabaseMatches to throw');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toMatch(/password/i);
      expect(message).not.toMatch(/:\/\//);
      expect(message).not.toMatch(/@/);
    }
  });
});
