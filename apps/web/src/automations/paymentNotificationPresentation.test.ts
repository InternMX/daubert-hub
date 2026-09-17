import { describe, expect, it } from 'vitest';
import { executionStatusLabel, executionStatusSeverity, executionTimestamp, formatTimestamp, outcomeStatusLabel, outcomeStatusSeverity, processingStatusLabels, resultCountsSummary, resultStatusLabels, resultStatusSeverity } from './paymentNotificationPresentation';

describe('processing status labels', () => {
  it('translates every stored processingStatus value', () => {
    expect(processingStatusLabels.PENDIENTE).toBe('Pendiente');
    expect(processingStatusLabels.PROCESADO).toBe('Procesado');
    expect(processingStatusLabels.ERROR).toBe('Error de procesamiento');
  });
});

describe('outcomeStatusLabel', () => {
  it('translates COMPLETED/PARTIAL/FAILED', () => {
    expect(outcomeStatusLabel('COMPLETED')).toBe('Completado');
    expect(outcomeStatusLabel('PARTIAL')).toBe('Parcial');
    expect(outcomeStatusLabel('FAILED')).toBe('Fallido');
  });

  it('never renders null as Completado — a neutral label instead', () => {
    expect(outcomeStatusLabel(null)).toBe('Sin resultado disponible');
    expect(outcomeStatusLabel(null)).not.toBe('Completado');
  });
});

describe('outcomeStatusSeverity', () => {
  it('maps outcome to restrained semantic severities', () => {
    expect(outcomeStatusSeverity('COMPLETED')).toBe('success');
    expect(outcomeStatusSeverity('PARTIAL')).toBe('warning');
    expect(outcomeStatusSeverity('FAILED')).toBe('error');
    expect(outcomeStatusSeverity(null)).toBe('default');
  });
});

describe('executionStatusLabel/executionStatusSeverity (PN1.2 production findings)', () => {
  it('renders PENDIENTE as "Pendiente" regardless of outcomeStatus — never "Sin resultado disponible"', () => {
    expect(executionStatusLabel({ processingStatus: 'PENDIENTE', outcomeStatus: null })).toBe('Pendiente');
    expect(executionStatusSeverity({ processingStatus: 'PENDIENTE', outcomeStatus: null })).toBe('default');
  });

  it('renders a PROCESADO execution with a null outcome (zero results) as "Sin resultado disponible"', () => {
    expect(executionStatusLabel({ processingStatus: 'PROCESADO', outcomeStatus: null })).toBe('Sin resultado disponible');
    expect(executionStatusSeverity({ processingStatus: 'PROCESADO', outcomeStatus: null })).toBe('default');
  });

  it('defers to outcomeStatusLabel/outcomeStatusSeverity once processing has produced an outcome', () => {
    expect(executionStatusLabel({ processingStatus: 'PROCESADO', outcomeStatus: 'COMPLETED' })).toBe('Completado');
    expect(executionStatusLabel({ processingStatus: 'PROCESADO', outcomeStatus: 'PARTIAL' })).toBe('Parcial');
    expect(executionStatusLabel({ processingStatus: 'ERROR', outcomeStatus: 'FAILED' })).toBe('Fallido');
    expect(executionStatusSeverity({ processingStatus: 'PROCESADO', outcomeStatus: 'COMPLETED' })).toBe('success');
  });
});

describe('result status labels and severities', () => {
  it('translates LISTO/MANUAL/ERROR/OMITIDO', () => {
    expect(resultStatusLabels.LISTO).toBe('Listo');
    expect(resultStatusLabels.MANUAL).toBe('Manual');
    expect(resultStatusLabels.ERROR).toBe('Error');
    expect(resultStatusLabels.OMITIDO).toBe('Omitido');
  });

  it('maps LISTO/success, MANUAL/warning, ERROR/error, OMITIDO/default', () => {
    expect(resultStatusSeverity('LISTO')).toBe('success');
    expect(resultStatusSeverity('MANUAL')).toBe('warning');
    expect(resultStatusSeverity('ERROR')).toBe('error');
    expect(resultStatusSeverity('OMITIDO')).toBe('default');
  });
});

describe('resultCountsSummary', () => {
  it('always shows all four counters, including zero counts', () => {
    expect(resultCountsSummary({ readyCount: 4, manualCount: 1, errorCount: 0, omittedCount: 0 })).toBe('4 Listos · 1 Manual · 0 Error · 0 Omitidos');
  });
});

describe('formatTimestamp / executionTimestamp', () => {
  it('formats a valid ISO timestamp with a Spanish/Mexico date and 24h time', () => {
    expect(formatTimestamp('2026-09-08T18:35:00.000Z')).toMatch(/^\d{1,2} \p{L}{3} 2026 · \d{2}:\d{2}$/u);
  });

  it('never renders "Invalid Date" for a null value', () => {
    expect(formatTimestamp(null)).toBe('Fecha no disponible');
  });

  it('never renders "Invalid Date" for an unparsable value', () => {
    expect(formatTimestamp('not-a-date')).toBe('Fecha no disponible');
    expect(formatTimestamp('not-a-date')).not.toMatch(/Invalid Date/);
  });

  it('prefers processedAt over createdAt when both are present', () => {
    const result = executionTimestamp({ processedAt: '2026-09-08T18:35:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(result).not.toContain('2026-01-01');
  });

  it('falls back to createdAt when processedAt is null', () => {
    const withProcessed = executionTimestamp({ processedAt: '2026-09-08T18:35:00.000Z', createdAt: '2026-09-08T18:35:00.000Z' });
    const fallback = executionTimestamp({ processedAt: null, createdAt: '2026-09-08T18:35:00.000Z' });
    expect(fallback).toBe(withProcessed);
  });
});
