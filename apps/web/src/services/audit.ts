import { apiBaseUrl } from './api';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE';
export type AuditModuleKey = 'COMPANIES' | 'CONTACTS' | 'USERS' | 'AUTOMATIONS';

// Mirrors GET /api/audit/events. The backend already reduces each event to an
// allowlisted set of fields; nothing here is raw JSONB, and a password_hash,
// token or secret is never part of the contract.
export interface AuditEvent {
  id: string;
  occurredAt: string;
  actor: { id: string | null; email: string | null; displayName: string | null } | null;
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

export interface AuditEventDetail extends AuditEvent {
  changes: AuditFieldChange[];
}

export interface AuditPageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AuditEventsPage {
  data: AuditEvent[];
  meta: AuditPageMeta;
}

export interface AuditEventsQuery {
  page: number;
  pageSize: number;
  from?: string;
  to?: string;
  userId?: string;
  entity?: string;
  action?: AuditAction;
}

export class AuditApiError extends Error {
  constructor(public readonly status: number, message?: string) {
    super(message ?? 'AUDIT_UNAVAILABLE');
  }
}

export const auditActionLabels: Record<AuditAction, string> = { CREATE: 'Creación', UPDATE: 'Actualización', DELETE: 'Eliminación' };

// Kept in step with apps/api/src/audit/audit-catalog.ts (entity keys + labels).
export const auditEntityOptions: Array<{ module: string; options: Array<{ key: string; label: string }> }> = [
  { module: 'Empresas', options: [{ key: 'COMPANY', label: 'Empresa' }, { key: 'COMPANY_ROLE', label: 'Rol de empresa' }, { key: 'COMPANY_FISCAL', label: 'Datos fiscales' }, { key: 'COMPANY_ALIAS', label: 'Alias de empresa' }, { key: 'COMPANY_ADDRESS', label: 'Dirección' }] },
  { module: 'Contactos', options: [{ key: 'CONTACT', label: 'Contacto' }, { key: 'CONTACT_METHOD', label: 'Medio de contacto' }] },
  { module: 'Usuarios', options: [{ key: 'USER', label: 'Usuario' }] },
  { module: 'Automatizaciones', options: [{ key: 'AUTOMATION_TRIGGER_REQUEST', label: 'Disparo manual' }, { key: 'AUTOMATION_REVIEW_ACK', label: 'Acuse de revisión' }] }
];

const actions = new Set<string>(['CREATE', 'UPDATE', 'DELETE']);
const modules = new Set<string>(['COMPANIES', 'CONTACTS', 'USERS', 'AUTOMATIONS']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const nullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';

function isAuditEvent(value: unknown): value is AuditEvent {
  if (!isRecord(value)) return false;
  const { actor, category, entity, record } = value;
  return typeof value.id === 'string'
    && typeof value.occurredAt === 'string' && Number.isFinite(new Date(value.occurredAt).getTime())
    && (actor === null || (isRecord(actor) && nullableString(actor.id) && nullableString(actor.email) && nullableString(actor.displayName)))
    && typeof value.origin === 'string'
    && isRecord(category) && typeof category.key === 'string' && modules.has(category.key) && typeof category.label === 'string'
    && typeof value.action === 'string' && actions.has(value.action)
    && isRecord(entity) && typeof entity.key === 'string' && typeof entity.label === 'string'
    && isRecord(record) && nullableString(record.reference) && nullableString(record.label)
    && nullableString(value.requestId)
    && typeof value.changedFieldCount === 'number';
}

function isFieldChange(value: unknown): value is AuditFieldChange {
  return isRecord(value) && typeof value.field === 'string' && typeof value.label === 'string' && nullableString(value.before) && nullableString(value.after);
}

function isMeta(value: unknown): value is AuditPageMeta {
  return isRecord(value) && ['page', 'pageSize', 'total', 'totalPages'].every((key) => typeof value[key] === 'number');
}

async function readBody(path: string): Promise<unknown> {
  let response: Response;
  try { response = await fetch(`${apiBaseUrl}${path}`); }
  catch { throw new AuditApiError(0); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new AuditApiError(response.status);
  return body;
}

export async function listAuditEvents(query: AuditEventsQuery): Promise<AuditEventsPage> {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  for (const key of ['from', 'to', 'userId', 'entity', 'action'] as const) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  const body = await readBody(`/audit/events?${params}`);
  if (!isRecord(body) || !Array.isArray(body.data) || !body.data.every(isAuditEvent) || !isMeta(body.meta)) throw new AuditApiError(200);
  return { data: body.data, meta: body.meta };
}

export async function getAuditEvent(id: string): Promise<AuditEventDetail> {
  const body = await readBody(`/audit/events/${encodeURIComponent(id)}`);
  const data = isRecord(body) ? body.data : null;
  if (!isAuditEvent(data)) throw new AuditApiError(200);
  const { changes } = data as unknown as { changes?: unknown };
  if (!Array.isArray(changes) || !changes.every(isFieldChange)) throw new AuditApiError(200);
  return { ...data, changes };
}

// Mexico no longer observes DST, so a local calendar day is [00:00, 24:00) at a
// fixed UTC-6 — the same zone the rest of the Hub renders timestamps in.
const DAY_OFFSET = '-06:00';

export function dayStartIso(date: string): string {
  return new Date(`${date}T00:00:00${DAY_OFFSET}`).toISOString();
}

export function nextDayStartIso(date: string): string {
  const next = new Date(`${date}T00:00:00${DAY_OFFSET}`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}
