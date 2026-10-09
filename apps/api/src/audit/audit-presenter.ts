import { ACTION_BY_OPERATION, AUDIT_MODULE_LABELS, isSensitiveFieldName, type AuditAction, type AuditEntityDefinition, type AuditModuleKey } from './audit-catalog';

export type AuditSnapshot = Record<string, unknown> | null;

export interface AuditEventActor {
  id: string | null;
  email: string | null;
  // Best-effort current name; audit.cambios only stores the historical email.
  displayName: string | null;
}

export interface AuditEventSummary {
  id: string;
  occurredAt: string;
  actor: AuditEventActor | null;
  origin: string;
  category: { key: AuditModuleKey; label: string };
  action: AuditAction;
  entity: { key: string; label: string };
  record: { reference: string | null; label: string | null };
  requestId: string | null;
  changedFieldCount: number;
}

export interface AuditFieldChange {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
}

export interface AuditEventDetail extends AuditEventSummary {
  changes: AuditFieldChange[];
}

export interface AuditSourceRow {
  cambio_id: string;
  fecha: Date | string;
  esquema: string;
  tabla: string;
  registro_id: string | null;
  operacion: string;
  usuario_id: string | null;
  usuario_email: string | null;
  origen: string;
  request_id: string | null;
  datos_anteriores: AuditSnapshot;
  datos_nuevos: AuditSnapshot;
}

const MAX_VALUE_LENGTH = 500;

// Only scalar values are ever shown; anything structured is dropped rather
// than stringified, so nested JSON can never leak through a presented field.
function formatValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value;
  return null;
}

function allowedFields(entity: AuditEntityDefinition) {
  return entity.fields.filter((field) => !isSensitiveFieldName(field.key));
}

export function buildChanges(entity: AuditEntityDefinition, action: AuditAction, before: AuditSnapshot, after: AuditSnapshot): AuditFieldChange[] {
  const changes: AuditFieldChange[] = [];
  for (const field of allowedFields(entity)) {
    const rawBefore = action === 'CREATE' ? null : before?.[field.key];
    const rawAfter = action === 'DELETE' ? null : after?.[field.key];
    const previous = formatValue(rawBefore);
    const next = formatValue(rawAfter);
    if (action === 'UPDATE' && previous === next) continue;
    if (previous === null && next === null) continue;
    changes.push({ field: field.key, label: field.label, before: previous, after: next });
  }
  return changes;
}

function recordLabel(entity: AuditEntityDefinition, row: AuditSourceRow): string | null {
  if (!entity.recordLabelField || isSensitiveFieldName(entity.recordLabelField)) return null;
  return formatValue(row.datos_nuevos?.[entity.recordLabelField]) ?? formatValue(row.datos_anteriores?.[entity.recordLabelField]);
}

export function presentSummary(entity: AuditEntityDefinition, row: AuditSourceRow, actorDisplayNames: Map<string, string>, changes: AuditFieldChange[]): AuditEventSummary | null {
  const action = ACTION_BY_OPERATION[row.operacion];
  if (!action) return null;
  const actor: AuditEventActor | null = row.usuario_id || row.usuario_email
    ? { id: row.usuario_id, email: row.usuario_email, displayName: row.usuario_id ? actorDisplayNames.get(row.usuario_id) ?? null : null }
    : null;
  return {
    id: row.cambio_id,
    occurredAt: new Date(row.fecha).toISOString(),
    actor,
    origin: row.origen,
    category: { key: entity.module, label: AUDIT_MODULE_LABELS[entity.module] },
    action,
    entity: { key: entity.key, label: entity.label },
    record: { reference: row.registro_id, label: recordLabel(entity, row) },
    requestId: row.request_id,
    changedFieldCount: changes.length
  };
}

export function presentDetail(entity: AuditEntityDefinition, row: AuditSourceRow, actorDisplayNames: Map<string, string>): AuditEventDetail | null {
  const action = ACTION_BY_OPERATION[row.operacion];
  if (!action) return null;
  const changes = buildChanges(entity, action, row.datos_anteriores, row.datos_nuevos);
  const summary = presentSummary(entity, row, actorDisplayNames, changes);
  return summary ? { ...summary, changes } : null;
}
