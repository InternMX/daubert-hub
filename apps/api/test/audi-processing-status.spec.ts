import { describe, expect, it } from 'vitest';
import { mapAudiExecutionState } from '../src/automations/audi-processing-status';

describe('mapAudiExecutionState', () => {
  it.each([
    ['COMPLETADA', 'COMPLETED'],
    ['ERROR', 'FAILED'],
    ['PROCESANDO', 'PROCESSING'],
    ['CANCELADA', 'CANCELLED']
  ] as const)('maps %s to %s', (estado, expected) => {
    expect(mapAudiExecutionState(estado)).toBe(expected);
  });

  it('returns null for an unknown value rather than fabricating an outcome', () => {
    expect(mapAudiExecutionState('UNKNOWN')).toBeNull();
  });
});
