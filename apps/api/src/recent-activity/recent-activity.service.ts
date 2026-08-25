import { Injectable } from '@nestjs/common';
import type { ListRecentActivityDto } from './dto/list-recent-activity.dto';
import { RecentActivityRepository, type RecentActivitySource } from './recent-activity.repository';

type Snapshot = Record<string, unknown> | null;
type ActivityType = 'PROVIDER_CREATED' | 'PROVIDER_UPDATED' | 'CONTACT_CREATED' | 'CONTACT_UPDATED' | 'CONTACT_METHOD_ADDED' | 'CONTACT_METHOD_UPDATED' | 'CONTACT_METHOD_DEACTIVATED' | 'CONTACT_METHOD_REACTIVATED';

export interface RecentActivityItem {
  type: ActivityType;
  title: string;
  entity: string;
  context: string | null;
  occurredAt: string;
}

export interface RecentActivityResponse {
  data: RecentActivityItem[];
}

interface SourceRow {
  request_id: string;
  schema_name: string;
  table_name: string;
  operation: string;
  before_data: Snapshot;
  after_data: Snapshot;
  occurred_at: Date | string;
}

const titles: Record<ActivityType, string> = {
  PROVIDER_CREATED: 'Proveedor creado',
  PROVIDER_UPDATED: 'Proveedor actualizado',
  CONTACT_CREATED: 'Contacto creado',
  CONTACT_UPDATED: 'Contacto actualizado',
  CONTACT_METHOD_ADDED: 'Medio de contacto agregado',
  CONTACT_METHOD_UPDATED: 'Medio de contacto actualizado',
  CONTACT_METHOD_DEACTIVATED: 'Medio de contacto desactivado',
  CONTACT_METHOD_REACTIVATED: 'Medio de contacto reactivado'
};

const providerRoles = new Set(['PROVEEDOR', 'SERVICIO', 'FLETE']);
const providerBusinessFields = new Set(['tipo_empresa', 'nombre_comercial', 'observaciones']);
const contactBusinessFields = new Set(['nombre', 'area', 'cargo', 'observaciones']);
const ignoredTimestampFields = new Set(['updated_at']);

function value(snapshot: Snapshot, key: string): unknown {
  return snapshot?.[key];
}

function id(snapshot: Snapshot, key: string): string | null {
  const candidate = value(snapshot, key);
  return typeof candidate === 'string' || typeof candidate === 'number' ? String(candidate) : null;
}

function text(snapshot: Snapshot, key: string): string | null {
  const candidate = value(snapshot, key);
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

function changedFields(before: Snapshot, after: Snapshot): Set<string> {
  if (!before || !after) return new Set();
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return new Set([...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])));
}

@Injectable()
export class RecentActivityService {
  constructor(private readonly repository: RecentActivityRepository) {}

  async list(input: ListRecentActivityDto): Promise<RecentActivityResponse> {
    const source = await this.repository.findRecent(input.limit);
    const groups = new Map<string, SourceRow[]>();
    for (const row of source.rows) groups.set(row.request_id, [...(groups.get(row.request_id) ?? []), row]);

    const data: RecentActivityItem[] = [];
    for (const rows of groups.values()) {
      const activity = this.classify(rows, source);
      if (activity) data.push(activity);
      if (data.length === input.limit) break;
    }
    return { data };
  }

  private classify(rows: SourceRow[], source: RecentActivitySource): RecentActivityItem | null {
    if (rows.length === 0 || rows.some((row) => row.schema_name !== 'core' || typeof row.operation !== 'string' || !['INSERT', 'UPDATE'].includes(row.operation.toUpperCase()))) return null;
    const timestamp = Math.max(...rows.map((row) => new Date(row.occurred_at).getTime()));
    if (!Number.isFinite(timestamp)) return null;
    const occurredAt = new Date(timestamp).toISOString();
    return this.providerCreate(rows, source, occurredAt)
      ?? this.providerUpdate(rows, source, occurredAt)
      ?? this.contactCreate(rows, source, occurredAt)
      ?? this.contactUpdate(rows, source, occurredAt)
      ?? this.methodChange(rows, source, occurredAt);
  }

  private providerCreate(rows: SourceRow[], source: RecentActivitySource, occurredAt: string): RecentActivityItem | null {
    const companies = rows.filter((row) => row.table_name === 'empresas' && row.operation.toUpperCase() === 'INSERT');
    const roles = rows.filter((row) => row.table_name === 'empresa_roles' && row.operation.toUpperCase() === 'INSERT');
    const fiscals = rows.filter((row) => row.table_name === 'empresas_fiscales' && row.operation.toUpperCase() === 'INSERT');
    if (companies.length !== 1 || roles.length !== 1 || rows.length !== 2 + fiscals.length) return null;
    const companyId = id(companies[0]!.after_data, 'empresa_id');
    if (!companyId || id(roles[0]!.after_data, 'empresa_id') !== companyId || !providerRoles.has(text(roles[0]!.after_data, 'rol') ?? '')) return null;
    if (fiscals.some((row) => id(row.after_data, 'empresa_id') !== companyId)) return null;
    return this.item('PROVIDER_CREATED', text(companies[0]!.after_data, 'nombre_comercial') ?? source.companies.get(companyId) ?? null, null, occurredAt);
  }

  private providerUpdate(rows: SourceRow[], source: RecentActivitySource, occurredAt: string): RecentActivityItem | null {
    const companies = rows.filter((row) => row.table_name === 'empresas' && row.operation.toUpperCase() === 'UPDATE');
    const fiscals = rows.filter((row) => row.table_name === 'empresas_fiscales' && ['INSERT', 'UPDATE'].includes(row.operation.toUpperCase()));
    if (companies.length === 0 && fiscals.length === 0) return null;
    const allowed = rows.every((row) => (row.table_name === 'empresas' && row.operation.toUpperCase() === 'UPDATE')
      || (row.table_name === 'empresa_roles' && row.operation.toUpperCase() === 'UPDATE')
      || (row.table_name === 'empresas_fiscales' && ['INSERT', 'UPDATE'].includes(row.operation.toUpperCase())));
    if (!allowed) return null;
    if (companies.some((row) => [...changedFields(row.before_data, row.after_data)].some((field) => !ignoredTimestampFields.has(field) && !providerBusinessFields.has(field)))) return null;
    const roleRows = rows.filter((row) => row.table_name === 'empresa_roles');
    if (companies.length === 0 && roleRows.length > 0) return null;
    if (roleRows.some((row) => [...changedFields(row.before_data, row.after_data)].some((field) => !ignoredTimestampFields.has(field) && field !== 'rol'))) return null;
    const first = companies[0] ?? fiscals[0]!;
    const companyId = id(first.after_data, 'empresa_id') ?? id(first.before_data, 'empresa_id');
    if (!companyId || rows.some((row) => (id(row.after_data, 'empresa_id') ?? id(row.before_data, 'empresa_id')) !== companyId)) return null;
    if (roleRows.some((row) => !providerRoles.has(text(row.after_data, 'rol') ?? text(row.before_data, 'rol') ?? ''))) return null;
    const entity = companies.map((row) => text(row.after_data, 'nombre_comercial')).filter((name): name is string => Boolean(name)).at(-1)
      ?? companies.map((row) => text(row.before_data, 'nombre_comercial')).filter((name): name is string => Boolean(name)).at(-1)
      ?? source.companies.get(companyId) ?? null;
    return this.item('PROVIDER_UPDATED', entity, null, occurredAt);
  }

  private contactCreate(rows: SourceRow[], source: RecentActivitySource, occurredAt: string): RecentActivityItem | null {
    const contacts = rows.filter((row) => row.table_name === 'contactos' && row.operation.toUpperCase() === 'INSERT');
    const methods = rows.filter((row) => row.table_name === 'medios_contacto' && row.operation.toUpperCase() === 'INSERT');
    if (contacts.length !== 1 || rows.length !== 1 + methods.length) return null;
    const contact = contacts[0]!;
    const contactId = id(contact.after_data, 'contacto_id');
    if (!contactId || methods.some((row) => id(row.after_data, 'contacto_id') !== contactId)) return null;
    const companyId = id(contact.after_data, 'empresa_id') ?? source.contacts.get(contactId)?.company_id ?? null;
    return this.item('CONTACT_CREATED', this.contactLabel(contact.after_data, source, contactId), companyId ? source.companies.get(companyId) ?? null : null, occurredAt);
  }

  private contactUpdate(rows: SourceRow[], source: RecentActivitySource, occurredAt: string): RecentActivityItem | null {
    if (rows.length !== 1 || rows[0]!.table_name !== 'contactos' || rows[0]!.operation.toUpperCase() !== 'UPDATE') return null;
    const row = rows[0]!;
    const changed = changedFields(row.before_data, row.after_data);
    const meaningful = [...changed].filter((field) => !ignoredTimestampFields.has(field));
    if (meaningful.length === 0 || meaningful.some((field) => !contactBusinessFields.has(field))) return null;
    const contactId = id(row.after_data, 'contacto_id') ?? id(row.before_data, 'contacto_id');
    const companyId = id(row.after_data, 'empresa_id') ?? id(row.before_data, 'empresa_id') ?? (contactId ? source.contacts.get(contactId)?.company_id : null) ?? null;
    return this.item('CONTACT_UPDATED', this.contactLabel(row.after_data ?? row.before_data, source, contactId), companyId ? source.companies.get(companyId) ?? null : null, occurredAt);
  }

  private methodChange(rows: SourceRow[], source: RecentActivitySource, occurredAt: string): RecentActivityItem | null {
    if (rows.length !== 1 || rows[0]!.table_name !== 'medios_contacto') return null;
    const row = rows[0]!;
    const operation = row.operation.toUpperCase();
    let type: ActivityType;
    if (operation === 'INSERT') {
      type = 'CONTACT_METHOD_ADDED';
    } else if (operation === 'UPDATE') {
      const beforeStatus = text(row.before_data, 'estatus');
      const afterStatus = text(row.after_data, 'estatus');
      const changed = changedFields(row.before_data, row.after_data);
      const known = new Set(['estatus', 'valor', 'tipo_medio', ...ignoredTimestampFields]);
      if ([...changed].some((field) => !known.has(field))) return null;
      if (beforeStatus === 'ACTIVO' && afterStatus === 'INACTIVO') type = 'CONTACT_METHOD_DEACTIVATED';
      else if (beforeStatus === 'INACTIVO' && afterStatus === 'ACTIVO') type = 'CONTACT_METHOD_REACTIVATED';
      else if (beforeStatus === afterStatus && (changed.has('valor') || changed.has('tipo_medio'))) type = 'CONTACT_METHOD_UPDATED';
      else return null;
    } else return null;

    const contactId = id(row.after_data, 'contacto_id') ?? id(row.before_data, 'contacto_id');
    const entity = text(row.after_data, 'valor') ?? text(row.before_data, 'valor');
    const companyId = contactId ? source.contacts.get(contactId)?.company_id : null;
    const context = companyId ? source.companies.get(companyId) ?? null : null;
    return this.item(type, entity, context, occurredAt);
  }

  private contactLabel(snapshot: Snapshot, source: RecentActivitySource, contactId: string | null): string | null {
    const current = contactId ? source.contacts.get(contactId) : undefined;
    const name = text(snapshot, 'nombre') ?? (current?.name?.trim() || null);
    if (name) return name;
    const area = text(snapshot, 'area') ?? (current?.area?.trim() || null);
    if (area) return area;
    const contactType = text(snapshot, 'tipo_contacto') ?? current?.contact_type;
    return contactType === 'BUZON_GENERICO' ? 'Buzón general' : null;
  }

  private item(type: ActivityType, entity: string | null, context: string | null, occurredAt: string): RecentActivityItem | null {
    return entity ? { type, title: titles[type], entity, context, occurredAt } : null;
  }
}
