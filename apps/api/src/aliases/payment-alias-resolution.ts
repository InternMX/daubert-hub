import { normalizePaymentAlias } from './payment-alias';

export interface PaymentAliasRecord {
  aliasId: string;
  companyId: string;
  companyName: string;
  alias: string;
  normalizedAlias: string;
  status: 'ACTIVO' | 'INACTIVO';
  type: string;
  // PostgreSQL text, retaining microseconds for optimistic concurrency checks.
  updatedAt: string;
}

export interface PaymentAliasResolution {
  alias: string;
  normalizedAlias: string;
  state: 'UNASSIGNED' | 'ACTIVE' | 'INACTIVE' | 'CONFLICT' | 'NAME_ONLY';
  assignment: PaymentAliasRecord | null;
  company: { id: string; name: string } | null;
}

export function resolvePaymentAlias(alias: string, records: PaymentAliasRecord[], companies: Array<{ id: string; name: string }>): PaymentAliasResolution {
  const normalizedAlias = normalizePaymentAlias(alias);
  const result: PaymentAliasResolution = { alias, normalizedAlias, state: 'UNASSIGNED', assignment: null, company: null };
  if (!normalizedAlias) return result;
  const matching = records.filter((record) => normalizePaymentAlias(record.alias) === normalizedAlias);
  const active = matching.filter((record) => record.status === 'ACTIVO');
  const names = companies.filter((company) => normalizePaymentAlias(company.name) === normalizedAlias);
  const companyIds = new Set([...active.map((record) => record.companyId), ...names.map((company) => company.id)]);
  if (companyIds.size > 1 || active.length > 1) return { ...result, state: 'CONFLICT' };
  if (active[0]) return { ...result, state: 'ACTIVE', assignment: active[0], company: { id: active[0].companyId, name: active[0].companyName } };
  // A commercial name remains detectable after an alias is deactivated; do not falsely claim
  // that deactivating an alias can disable the company's own commercial name in n8n.
  if (names[0]) return { ...result, state: 'NAME_ONLY', company: names[0] };
  // Repository returns newest aliases first. Inactive rows provide traceability, never routing.
  const inactive = matching.find((record) => record.status === 'INACTIVO');
  return inactive ? { ...result, state: 'INACTIVE', assignment: inactive } : result;
}
