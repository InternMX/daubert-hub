import { describe, expect, it } from 'vitest';
import type { AutomationOverview } from '../services/automationsOverview';
import { automationHealthAccent, automationHealthTexts, formatCardTimestamp, lifecycleStatusLabel, processingOutcomeLabel } from './automationOverviewPresentation';

const NO_REVIEW = { required: false, problemOccurredAt: null, problemOutcome: null } as const;

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
    review: NO_REVIEW,
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

describe('automationHealthAccent (Phase 10I UX refinement §2)', () => {
  it('returns "error" when the latest processing outcome is FAILED', () => {
    expect(automationHealthAccent(automation({ lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome: 'FAILED' } }))).toBe('error');
  });

  it('returns "error" even once the FAILED problem has been acknowledged — acknowledged is never fixed', () => {
    expect(automationHealthAccent(automation({
      lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome: 'FAILED' },
      review: { required: false, problemOccurredAt: '2026-08-27T22:40:01.933Z', problemOutcome: 'FAILED' }
    }))).toBe('error');
  });

  it('returns "warning" when review.required is true and the latest processing is not FAILED', () => {
    expect(automationHealthAccent(automation({
      lastProcessing: { occurredAt: '2026-08-28T00:00:00.000Z', outcome: 'COMPLETED' },
      review: { required: true, problemOccurredAt: '2026-08-27T22:40:01.933Z', problemOutcome: 'FAILED' }
    }))).toBe('warning');
  });

  it('never returns both — RED beats WARNING when both conditions apply', () => {
    const accent = automationHealthAccent(automation({
      lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome: 'FAILED' },
      review: { required: true, problemOccurredAt: '2026-08-27T22:40:01.933Z', problemOutcome: 'FAILED' }
    }));
    expect(accent).toBe('error');
  });

  it('returns null when there is no problem at all', () => {
    expect(automationHealthAccent(automation())).toBeNull();
  });

  it('never returns an accent for a NOT_INTEGRATED automation, regardless of its fields', () => {
    expect(automationHealthAccent(automation({
      integrationStatus: 'NOT_INTEGRATED',
      lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome: 'FAILED' },
      review: { required: true, problemOccurredAt: '2026-08-27T22:40:01.933Z', problemOutcome: 'FAILED' }
    }))).toBeNull();
  });

  it('never returns an accent for an IN_PREPARATION automation, regardless of its fields (Phase 12A.2)', () => {
    expect(automationHealthAccent(automation({
      integrationStatus: 'IN_PREPARATION',
      lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome: 'FAILED' },
      review: { required: true, problemOccurredAt: '2026-08-27T22:40:01.933Z', problemOutcome: 'FAILED' }
    }))).toBeNull();
  });

  it('never returns "success" — no healthy accent exists', () => {
    const accent = automationHealthAccent(automation());
    expect(accent).not.toBe('success');
  });
});

describe('automationHealthTexts (Phase 10I UX refinement §2)', () => {
  it('shows both texts when FAILED and review.required are both true', () => {
    const texts = automationHealthTexts(automation({
      lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome: 'FAILED' },
      review: { required: true, problemOccurredAt: '2026-08-27T22:40:01.933Z', problemOutcome: 'FAILED' }
    }));
    expect(texts).toEqual([
      { text: 'Último procesamiento falló', color: 'error' },
      { text: 'Requiere revisión', color: 'warning' }
    ]);
  });

  it('shows only the failure text once acknowledged (review.required=false) — acknowledged is never fixed', () => {
    const texts = automationHealthTexts(automation({
      lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome: 'FAILED' },
      review: { required: false, problemOccurredAt: '2026-08-27T22:40:01.933Z', problemOutcome: 'FAILED' }
    }));
    expect(texts).toEqual([{ text: 'Último procesamiento falló', color: 'error' }]);
  });

  it('shows only the review text when review.required is true and the latest processing is not FAILED', () => {
    const texts = automationHealthTexts(automation({
      lastProcessing: { occurredAt: '2026-08-28T00:00:00.000Z', outcome: 'COMPLETED' },
      review: { required: true, problemOccurredAt: '2026-08-27T22:40:01.933Z', problemOutcome: 'FAILED' }
    }));
    expect(texts).toEqual([{ text: 'Requiere revisión', color: 'warning' }]);
  });

  it('shows no text when there is no problem at all', () => {
    expect(automationHealthTexts(automation())).toEqual([]);
  });

  it('never shows text for a NOT_INTEGRATED automation, regardless of its fields', () => {
    expect(automationHealthTexts(automation({
      integrationStatus: 'NOT_INTEGRATED',
      lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome: 'FAILED' },
      review: { required: true, problemOccurredAt: '2026-08-27T22:40:01.933Z', problemOutcome: 'FAILED' }
    }))).toEqual([]);
  });

  it('never shows text for an IN_PREPARATION automation, regardless of its fields (Phase 12A.2)', () => {
    expect(automationHealthTexts(automation({
      integrationStatus: 'IN_PREPARATION',
      lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome: 'FAILED' },
      review: { required: true, problemOccurredAt: '2026-08-27T22:40:01.933Z', problemOutcome: 'FAILED' }
    }))).toEqual([]);
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
