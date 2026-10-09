import type { AuditEvent } from '../services/audit';

export function auditActorLabel(actor: AuditEvent['actor']): string {
  if (!actor) return 'Sistema';
  const name = actor.displayName?.trim();
  const email = actor.email?.trim();
  if (name && email) return `${name} (${email})`;
  return name || email || (actor.id ? `Usuario #${actor.id}` : 'Sistema');
}

const originLabels: Record<string, string> = { DAUBERT_HUB: 'Daubert Hub', SISTEMA: 'Sistema' };

export function auditOriginLabel(origin: string): string {
  return originLabels[origin] ?? origin;
}
