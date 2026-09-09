import { describe, expect, it } from 'vitest';
import type { AutomationOverview } from '../services/automationsOverview';
import { formatCardTimestamp, lifecycleStatusLabel, processingOutcomeLabel, requiresReview } from './automationOverviewPresentation';

function automation(overrides: Partial<AutomationOverview> = {}): AutomationOverview {
  return {
    code: 'REMISIONES_AUDI',
    name: 'Remisiones Audi',
    description: 'Generación y control de remisiones.',
    integrationStatus: 'INTEGRATED',
    environment: 'TEST',
    lifecycleStatus: 'ACTIVE',
    polling: { intervalMinutes: 10, label: 'Cada 10 minutos' },
    lastCheckAt: null,
    lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome: 'COMPLETED' },
    nextCheckAt: null,
    capabilities: { hasDashboard: true, hasHistory: true, hasDetail: false },
    ...overrides
  };
}

describe('lifecycleStatusLabel', () => {
  it('translates ACTIVE and INACTIVE', () => {
    expect(lifecycleStatusLabel('ACTIVE')).toBe('Activa');
    expect(lifecycleStatusLabel('INACTIVE')).toBe('Inactiva');
  });

  it('returns null when there is no lifecycle concept for this automation', () => {
    expect(lifecycleStatusLabel(null)).toBeNull();
  });
});

describe('processingOutcomeLabel', () => {
  it('translates every known outcome', () => {
    expect(processingOutcomeLabel('COMPLETED')).toBe('Completado');
    expect(processingOutcomeLabel('PARTIAL')).toBe('Parcial');
    expect(processingOutcomeLabel('FAILED')).toBe('Fallido');
    expect(processingOutcomeLabel('PROCESSING')).toBe('En proceso');
    expect(processingOutcomeLabel('CANCELLED')).toBe('Cancelado');
  });

  it('never renders a null outcome as a fabricated success', () => {
    expect(processingOutcomeLabel(null)).toBe('Sin resultado disponible');
    expect(processingOutcomeLabel(null)).not.toBe('Completado');
  });
});

describe('requiresReview', () => {
  it.each(['PARTIAL', 'FAILED', 'CANCELLED'] as const)('counts an INTEGRATED automation whose latest outcome is %s', (outcome) => {
    expect(requiresReview(automation({ lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome } }))).toBe(true);
  });

  it.each(['COMPLETED', 'PROCESSING', null] as const)('does not count an INTEGRATED automation whose latest outcome is %s', (outcome) => {
    expect(requiresReview(automation({ lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome } }))).toBe(false);
  });

  it('does not count an automation with no processing at all', () => {
    expect(requiresReview(automation({ lastProcessing: null }))).toBe(false);
  });

  it('never counts a NOT_INTEGRATED automation, even with a failure-shaped outcome', () => {
    expect(requiresReview(automation({ integrationStatus: 'NOT_INTEGRATED', lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome: 'FAILED' } }))).toBe(false);
  });
});

describe('formatCardTimestamp', () => {
  it('formats a valid timestamp without a year (compact card format)', () => {
    const result = formatCardTimestamp('2026-08-27T22:40:01.933Z');
    expect(result).toMatch(/^\d{1,2} \p{L}{3} · \d{2}:\d{2}$/u);
    expect(result).not.toContain('2026');
  });

  it('never renders "Invalid Date" for an unparsable value', () => {
    expect(formatCardTimestamp('not-a-date')).toBe('Fecha no disponible');
  });
});
