import { describe, expect, it } from 'vitest';
import { derivePaymentNotificationOutcome, deriveReprocessAvailability } from '../src/automations/payment-notifications/payment-notification-status';

const zero = { totalResults: 0, readyCount: 0, manualCount: 0, errorCount: 0, omittedCount: 0 };

describe('derivePaymentNotificationOutcome', () => {
  it('returns null for PENDIENTE regardless of counts', () => {
    expect(derivePaymentNotificationOutcome('PENDIENTE', zero)).toBeNull();
    expect(derivePaymentNotificationOutcome('PENDIENTE', { ...zero, totalResults: 3, readyCount: 3 })).toBeNull();
  });

  it('returns null for PROCESADO with zero provider results, never COMPLETED', () => {
    expect(derivePaymentNotificationOutcome('PROCESADO', zero)).toBeNull();
  });

  it('returns COMPLETED for PROCESADO with only LISTO/OMITIDO results', () => {
    expect(derivePaymentNotificationOutcome('PROCESADO', { ...zero, totalResults: 2, readyCount: 2 })).toBe('COMPLETED');
    expect(derivePaymentNotificationOutcome('PROCESADO', { ...zero, totalResults: 3, readyCount: 2, omittedCount: 1 })).toBe('COMPLETED');
  });

  it('returns PARTIAL for PROCESADO with at least one MANUAL or ERROR result', () => {
    expect(derivePaymentNotificationOutcome('PROCESADO', { ...zero, totalResults: 5, readyCount: 4, manualCount: 1 })).toBe('PARTIAL');
    expect(derivePaymentNotificationOutcome('PROCESADO', { ...zero, totalResults: 13, readyCount: 12, errorCount: 1 })).toBe('PARTIAL');
  });

  it('returns FAILED for a top-level ERROR with no useful provider results', () => {
    expect(derivePaymentNotificationOutcome('ERROR', zero)).toBe('FAILED');
    expect(derivePaymentNotificationOutcome('ERROR', { ...zero, totalResults: 1, errorCount: 1 })).toBe('FAILED');
  });

  it('returns PARTIAL for a top-level ERROR that still produced useful (LISTO/MANUAL/OMITIDO) results', () => {
    expect(derivePaymentNotificationOutcome('ERROR', { ...zero, totalResults: 2, readyCount: 1, errorCount: 1 })).toBe('PARTIAL');
  });
});

describe('deriveReprocessAvailability', () => {
  const none = { reactivatedOmittedCount: 0, hasPendingFileHash: false };

  it.each([
    ['ERROR correo without results', 'ERROR', zero, none, true],
    ['PROCESADO + all LISTO', 'PROCESADO', { ...zero, totalResults: 3, readyCount: 3 }, none, false],
    ['PROCESADO + MANUAL', 'PROCESADO', { ...zero, totalResults: 3, readyCount: 2, manualCount: 1 }, none, true],
    ['PROCESADO + ERROR result', 'PROCESADO', { ...zero, totalResults: 3, readyCount: 2, errorCount: 1 }, none, true],
    ['PROCESADO + OMITIDO with company disabled / without configuration / with a single flag', 'PROCESADO', { ...zero, totalResults: 1, omittedCount: 1 }, none, false],
    ['PROCESADO + OMITIDO with company enabled', 'PROCESADO', { ...zero, totalResults: 1, omittedCount: 1 }, { ...none, reactivatedOmittedCount: 1 }, true],
    ['PROCESADO + several LISTO + one enabled OMITIDO', 'PROCESADO', { ...zero, totalResults: 6, readyCount: 5, omittedCount: 1 }, { ...none, reactivatedOmittedCount: 1 }, true],
    ['PROCESADO + valid HASH', 'PROCESADO', { ...zero, totalResults: 2, readyCount: 2 }, { ...none, hasPendingFileHash: true }, true],
    ['PROCESADO + several LISTO + pending HASH', 'PROCESADO', { ...zero, totalResults: 5, readyCount: 5 }, { ...none, hasPendingFileHash: true }, true],
    ['PROCESADO + invalid HASH (flag false)', 'PROCESADO', { ...zero, totalResults: 2, readyCount: 2 }, none, false],
    ['PROCESADO with zero results and nothing pending', 'PROCESADO', zero, none, false],
    ['PENDIENTE without anything', 'PENDIENTE', zero, none, false],
    ['PENDIENTE even with MANUAL, enabled OMITIDO and HASH', 'PENDIENTE', { ...zero, totalResults: 2, manualCount: 1, omittedCount: 1 }, { reactivatedOmittedCount: 1, hasPendingFileHash: true }, false]
  ] as const)('%s', (_name, status, counts, signals, expected) => {
    expect(deriveReprocessAvailability(status, counts, signals)).toBe(expected);
  });
});
