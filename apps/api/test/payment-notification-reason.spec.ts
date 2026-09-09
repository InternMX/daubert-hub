import { describe, expect, it } from 'vitest';
import { mapAttentionReason } from '../src/automations/payment-notifications/payment-notification-reason';

describe('mapAttentionReason', () => {
  it('returns null when motivo is null, empty, or whitespace-only', () => {
    expect(mapAttentionReason(null)).toBeNull();
    expect(mapAttentionReason('')).toBeNull();
    expect(mapAttentionReason('   ')).toBeNull();
  });

  it('maps the confirmed DESTINATARIOS_PARA value to its restrained operational message', () => {
    expect(mapAttentionReason('DESTINATARIOS_PARA')).toBe('Faltan destinatarios principales configurados.');
  });

  it('never leaks an unknown non-null motivo value, returning the generic message instead', () => {
    expect(mapAttentionReason('SOME_FUTURE_INTERNAL_CODE')).toBe('Requiere revisión.');
    expect(mapAttentionReason('raw internal diagnostic text')).toBe('Requiere revisión.');
  });

  it('does not leak the raw value inside the generic message', () => {
    const result = mapAttentionReason('SOME_FUTURE_INTERNAL_CODE');
    expect(result).not.toMatch(/SOME_FUTURE_INTERNAL_CODE/);
  });
});
