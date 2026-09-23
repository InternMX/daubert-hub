import { describe, expect, it } from 'vitest';
import { formatGeneratedFolioRange, formatGeneratedRemissionsTitle } from '../src/recent-activity/remission-activity-presentation';

describe('formatGeneratedRemissionsTitle', () => {
  it('uses the singular form for exactly one remission', () => {
    expect(formatGeneratedRemissionsTitle(1)).toBe('1 remisión generada');
  });

  it.each([2, 5, 100])('uses the plural form for %d remissions', (count) => {
    expect(formatGeneratedRemissionsTitle(count)).toBe(`${count} remisiones generadas`);
  });
});

describe('formatGeneratedFolioRange', () => {
  it('formats a single folio when count is 1 and minimum equals maximum', () => {
    expect(formatGeneratedFolioRange(1, '7', '7')).toBe('Folio 7');
  });

  it('formats a range when the count exactly matches the contiguous span', () => {
    expect(formatGeneratedFolioRange(5, '119', '123')).toBe('Folios 119–123');
  });

  it('never fabricates a range for a non-contiguous aggregate (gaps in the generated folios)', () => {
    // Folios 969, 970, 973 generated: count=3, min=969, max=973 — NOT "969–973", which would
    // wrongly imply 971 and 972 were also generated.
    expect(formatGeneratedFolioRange(3, '969', '973')).toBeNull();
  });

  it('returns null for a single-folio count whose min/max disagree (inconsistent aggregate)', () => {
    expect(formatGeneratedFolioRange(1, '969', '973')).toBeNull();
  });

  it.each([
    [1, null, '123'],
    [1, '119', null],
    [1, null, null]
  ] as const)('degrades to null when either folio is missing (%s, %s, %s)', (count, minimum, maximum) => {
    expect(formatGeneratedFolioRange(count, minimum, maximum)).toBeNull();
  });

  it('degrades to null for non-positive or unparsable folios rather than inventing numbers', () => {
    expect(formatGeneratedFolioRange(1, '0', '0')).toBeNull();
    expect(formatGeneratedFolioRange(1, 'not-a-number', '5')).toBeNull();
  });

  it('degrades to null for an invalid count', () => {
    expect(formatGeneratedFolioRange(0, '7', '7')).toBeNull();
    expect(formatGeneratedFolioRange(-1, '7', '7')).toBeNull();
  });
});
