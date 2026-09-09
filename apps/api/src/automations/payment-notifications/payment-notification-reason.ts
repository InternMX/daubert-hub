// Presentation-safe mapping for core.resultados_notificacion_pago.motivo. `motivo` is an
// internal workflow value with no confirmed stable public vocabulary (Phase 10A) — only
// DESTINATARIOS_PARA is confirmed. Any other non-null value is deliberately generalized
// rather than exposed raw, so an unrecognized/future motivo can never leak internal wording.
const KNOWN_REASONS: Readonly<Record<string, string>> = {
  DESTINATARIOS_PARA: 'Faltan destinatarios principales configurados.'
};

const GENERIC_REASON = 'Requiere revisión.';

export function mapAttentionReason(motivo: string | null): string | null {
  const trimmed = motivo?.trim();
  if (!trimmed) return null;
  return KNOWN_REASONS[trimmed] ?? GENERIC_REASON;
}
