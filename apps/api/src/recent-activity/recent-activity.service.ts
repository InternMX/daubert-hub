import { Injectable } from '@nestjs/common';
import { derivePaymentNotificationOutcome } from '../automations/payment-notifications/payment-notification-status';
import { RecentActivityCategoryFilter, type ListRecentActivityDto } from './dto/list-recent-activity.dto';
import { DocumentSeriesActivityRepository, type DocumentSeriesActivityRow } from './document-series-activity.repository';
import { PaymentNotificationActivityRepository, type PaymentNotificationActivityRow } from './payment-notification-activity.repository';
import { RecentActivityRepository, type RecentActivitySource } from './recent-activity.repository';
import { RemisionesAudiActivityRepository, type RemisionesAudiActivityRow } from './remisiones-audi-activity.repository';

type Snapshot = Record<string, unknown> | null;
type ActivityType = 'PROVIDER_CREATED' | 'PROVIDER_UPDATED' | 'PROVIDER_DEACTIVATED' | 'PROVIDER_REACTIVATED' | 'CLIENT_CREATED' | 'CLIENT_UPDATED' | 'CLIENT_DEACTIVATED' | 'CLIENT_REACTIVATED' | 'CONTACT_CREATED' | 'CONTACT_UPDATED' | 'CONTACT_DEACTIVATED' | 'CONTACT_REACTIVATED' | 'CONTACT_METHOD_ADDED' | 'CONTACT_METHOD_UPDATED' | 'CONTACT_METHOD_DEACTIVATED' | 'CONTACT_METHOD_REACTIVATED' | 'AUTOMATION_COMPLETED' | 'AUTOMATION_PARTIAL' | 'AUTOMATION_FAILED' | 'AUTOMATION_CANCELLED' | 'DOCUMENT_SERIES_ADJUSTED';
export type ActivityCategory = 'PROVIDER' | 'CONTACT' | 'AUTOMATION' | 'CLIENT';

// The actor who performed the action, when known. Never fabricated: for a
// system/automation-generated event (no human actor at all) this is simply
// null — presentation decides how to label that later, the API contract
// does not force a "Sistema" string. displayName is a best-effort CURRENT
// enrichment from security.users by usuario_id; it is null when that lookup
// doesn't resolve. email is always the HISTORICAL snapshot recorded on the
// audit row / ledger entry at the time — audit.cambios (and
// operacion.ajustes_series) never store display_name, only usuario_email,
// so "current" and "historical" are genuinely different sources here by
// design (see Phase 9A/9B notes) — this is acceptable for V1 and is not a
// gap to fix with a schema change.
export interface RecentActivityActor {
  id: string | null;
  displayName: string | null;
  email: string | null;
}

export interface RecentActivityItem {
  type: ActivityType;
  category: ActivityCategory;
  title: string;
  entity: string;
  context: string | null;
  occurredAt: string;
  actor: RecentActivityActor | null;
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
  usuario_id: string | null;
  usuario_email: string | null;
}

const titles: Record<ActivityType, string> = {
  PROVIDER_CREATED: 'Proveedor creado',
  PROVIDER_UPDATED: 'Proveedor actualizado',
  PROVIDER_DEACTIVATED: 'Proveedor desactivado',
  PROVIDER_REACTIVATED: 'Proveedor reactivado',
  CLIENT_CREATED: 'Cliente creado',
  CLIENT_UPDATED: 'Cliente actualizado',
  CLIENT_DEACTIVATED: 'Cliente desactivado',
  CLIENT_REACTIVATED: 'Cliente reactivado',
  CONTACT_CREATED: 'Contacto creado',
  CONTACT_UPDATED: 'Contacto actualizado',
  CONTACT_DEACTIVATED: 'Contacto desactivado',
  CONTACT_REACTIVATED: 'Contacto reactivado',
  CONTACT_METHOD_ADDED: 'Medio de contacto agregado',
  CONTACT_METHOD_UPDATED: 'Medio de contacto actualizado',
  CONTACT_METHOD_DEACTIVATED: 'Medio de contacto desactivado',
  CONTACT_METHOD_REACTIVATED: 'Medio de contacto reactivado',
  AUTOMATION_COMPLETED: 'Automatización completada',
  AUTOMATION_PARTIAL: 'Automatización con incidencias',
  AUTOMATION_FAILED: 'Automatización con error',
  AUTOMATION_CANCELLED: 'Automatización cancelada',
  DOCUMENT_SERIES_ADJUSTED: 'Folio ajustado'
};

const categories: Record<ActivityType, ActivityCategory> = {
  PROVIDER_CREATED: 'PROVIDER',
  PROVIDER_UPDATED: 'PROVIDER',
  PROVIDER_DEACTIVATED: 'PROVIDER',
  PROVIDER_REACTIVATED: 'PROVIDER',
  CLIENT_CREATED: 'CLIENT',
  CLIENT_UPDATED: 'CLIENT',
  CLIENT_DEACTIVATED: 'CLIENT',
  CLIENT_REACTIVATED: 'CLIENT',
  CONTACT_CREATED: 'CONTACT',
  CONTACT_UPDATED: 'CONTACT',
  CONTACT_DEACTIVATED: 'CONTACT',
  CONTACT_REACTIVATED: 'CONTACT',
  CONTACT_METHOD_ADDED: 'CONTACT',
  CONTACT_METHOD_UPDATED: 'CONTACT',
  CONTACT_METHOD_DEACTIVATED: 'CONTACT',
  CONTACT_METHOD_REACTIVATED: 'CONTACT',
  AUTOMATION_COMPLETED: 'AUTOMATION',
  AUTOMATION_PARTIAL: 'AUTOMATION',
  AUTOMATION_FAILED: 'AUTOMATION',
  AUTOMATION_CANCELLED: 'AUTOMATION',
  DOCUMENT_SERIES_ADJUSTED: 'AUTOMATION'
};

const providerRoles = new Set(['PROVEEDOR', 'SERVICIO', 'FLETE']);
const providerBusinessFields = new Set(['tipo_empresa', 'nombre_comercial', 'observaciones']);
// Unlike Providers, the Clients mutation workflow never writes tipo_empresa (there is no
// Client "type" to change), so it is intentionally excluded here.
const clientBusinessFields = new Set(['nombre_comercial', 'observaciones']);
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
  constructor(
    private readonly repository: RecentActivityRepository,
    private readonly paymentNotifications: PaymentNotificationActivityRepository,
    private readonly remisionesAudi: RemisionesAudiActivityRepository,
    private readonly documentSeries: DocumentSeriesActivityRepository
  ) {}

  async list(input: ListRecentActivityDto): Promise<RecentActivityResponse> {
    const needsAudit = input.category !== RecentActivityCategoryFilter.AUTOMATION;
    const needsAutomation = input.category === undefined || input.category === RecentActivityCategoryFilter.AUTOMATION;
    const auditCategory = input.category === RecentActivityCategoryFilter.PROVIDER || input.category === RecentActivityCategoryFilter.CONTACT || input.category === RecentActivityCategoryFilter.CLIENT ? input.category : undefined;
    const [source, paymentRows, audiRows, seriesRows] = await Promise.all([
      needsAudit ? (auditCategory ? this.repository.findRecent(input.limit, auditCategory) : this.repository.findRecent(input.limit)) : null,
      needsAutomation ? this.paymentNotifications.findRecent(input.limit) : [],
      needsAutomation ? this.remisionesAudi.findRecent(input.limit) : [],
      needsAutomation ? this.documentSeries.findRecent(input.limit) : []
    ]);
    const seriesActorIds = [...new Set(seriesRows.map((row) => row.actor_id).filter((actorId): actorId is string => actorId !== null))];
    const seriesActorNames = seriesActorIds.length === 0 ? new Map<string, string>() : await this.documentSeries.findActorDisplayNames(seriesActorIds);
    const data = [
      ...(source ? this.auditActivities(source) : []),
      ...paymentRows.map((row) => this.paymentNotification(row)),
      ...audiRows.map((row) => this.audiActivity(row)),
      ...seriesRows.map((row) => this.documentSeriesAdjustment(row, seriesActorNames))
    ]
      .filter((item): item is RecentActivityItem => item !== null)
      .filter((item) => input.category === undefined || item.category === input.category)
      .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
      .slice(0, input.limit);
    return { data };
  }

  private auditActivities(source: RecentActivitySource): RecentActivityItem[] {
    const groups = new Map<string, SourceRow[]>();
    for (const row of source.rows) groups.set(row.request_id, [...(groups.get(row.request_id) ?? []), row]);

    const data: RecentActivityItem[] = [];
    for (const rows of groups.values()) {
      const activity = this.classify(rows, source);
      if (activity) data.push(activity);
    }
    return data;
  }

  private paymentNotification(row: PaymentNotificationActivityRow): RecentActivityItem | null {
    const occurredAt = new Date(row.occurred_at);
    if (!Number.isFinite(occurredAt.getTime()) || row.result_count < 0) return null;

    // Shared with the Payment Notifications dashboard (automations/payment-notifications) —
    // see payment-notification-status.ts. outcome === null (PENDIENTE, or PROCESADO with zero
    // results) means there is nothing worth showing here, exactly like the pre-extraction logic.
    const outcome = derivePaymentNotificationOutcome(row.execution_state, {
      totalResults: row.result_count,
      readyCount: row.ready_count,
      manualCount: row.manual_count,
      errorCount: row.error_count,
      omittedCount: row.omitted_count
    });
    if (outcome === null) return null;
    const type: ActivityType = outcome === 'COMPLETED' ? 'AUTOMATION_COMPLETED' : outcome === 'PARTIAL' ? 'AUTOMATION_PARTIAL' : 'AUTOMATION_FAILED';

    // System/automation-generated — no human actor.
    return this.item(type, 'Notificaciones de pago', this.paymentContext(row), occurredAt.toISOString(), null);
  }

  private audiActivity(row: RemisionesAudiActivityRow): RecentActivityItem | null {
    const occurredAt = new Date(row.occurred_at);
    const entity = row.automation_name?.trim();
    if (!entity || !Number.isFinite(occurredAt.getTime()) || !Number.isInteger(row.generated_count) || row.generated_count < 0) return null;

    if (row.execution_state === 'ERROR') {
      return { type: 'AUTOMATION_FAILED', category: 'AUTOMATION', title: 'Generación de remisiones con error', entity, context: 'No fue posible completar la automatización', occurredAt: occurredAt.toISOString(), actor: null };
    }
    if (row.execution_state === 'CANCELADA') {
      return { type: 'AUTOMATION_CANCELLED', category: 'AUTOMATION', title: 'Generación de remisiones cancelada', entity, context: null, occurredAt: occurredAt.toISOString(), actor: null };
    }
    if (row.execution_state !== 'COMPLETADA') return null;

    if (row.generated_count === 0) {
      return { type: 'AUTOMATION_COMPLETED', category: 'AUTOMATION', title: 'Ejecución completada sin remisiones generadas', entity, context: null, occurredAt: occurredAt.toISOString(), actor: null };
    }
    const minimum = this.positiveBigInt(row.minimum_folio);
    const maximum = this.positiveBigInt(row.maximum_folio);
    if (row.generated_count === 1) {
      const title = minimum !== null && minimum === maximum ? `Remisión ${minimum} generada` : '1 remisión generada';
      return { type: 'AUTOMATION_COMPLETED', category: 'AUTOMATION', title, entity, context: null, occurredAt: occurredAt.toISOString(), actor: null };
    }
    const contiguous = minimum !== null && maximum !== null && maximum >= minimum && BigInt(row.generated_count) === maximum - minimum + 1n;
    return {
      type: 'AUTOMATION_COMPLETED',
      category: 'AUTOMATION',
      title: `${row.generated_count} remisiones generadas`,
      entity,
      context: contiguous ? `Folios ${minimum}–${maximum}` : null,
      occurredAt: occurredAt.toISOString(),
      actor: null
    };
  }

  // operacion.ajustes_series is a real human-actor ledger (unlike the two
  // sources above), so — unlike those — this one CAN and does carry an
  // actor, sourced from the ledger's own usuario_id/usuario_email columns
  // and enriched with a current display name exactly like audit-derived
  // activities (see actorFor()).
  private documentSeriesAdjustment(row: DocumentSeriesActivityRow, actorNames: Map<string, string>): RecentActivityItem | null {
    const occurredAt = new Date(row.occurred_at);
    const entity = row.series_name?.trim();
    if (!entity || !Number.isFinite(occurredAt.getTime())) return null;
    const actor = row.actor_id ? { id: row.actor_id, displayName: actorNames.get(row.actor_id) ?? null, email: row.actor_email } : null;
    return this.item('DOCUMENT_SERIES_ADJUSTED', entity, `${row.folio_before} → ${row.folio_after}`, occurredAt.toISOString(), actor);
  }

  private positiveBigInt(value: string | null): bigint | null {
    if (!value) return null;
    try {
      const parsed = BigInt(value);
      return parsed > 0n ? parsed : null;
    } catch {
      return null;
    }
  }

  private paymentContext(row: PaymentNotificationActivityRow): string {
    const parts = [
      this.countLabel(row.ready_count, 'listo', 'listos'),
      this.countLabel(row.manual_count, 'manual', 'manuales'),
      this.countLabel(row.error_count, 'con error', 'con error'),
      this.countLabel(row.omitted_count, 'omitido', 'omitidos')
    ].filter((part): part is string => part !== null);
    return parts.join(' · ') || 'No fue posible completar la automatización';
  }

  private countLabel(count: number, singular: string, plural: string): string | null {
    return count > 0 ? `${count} ${count === 1 ? singular : plural}` : null;
  }

  // The actor for a whole grouped request: every row in `rows` shares one
  // set_config(...) call per transaction, so usuario_id/usuario_email is
  // identical across the group — reading it from the first row is enough.
  private actorFor(rows: SourceRow[], source: RecentActivitySource): RecentActivityActor | null {
    const usuarioId = rows[0]?.usuario_id ?? null;
    if (!usuarioId) return null;
    return { id: usuarioId, displayName: source.actorDisplayNames.get(usuarioId) ?? null, email: rows[0]?.usuario_email ?? null };
  }

  private classify(rows: SourceRow[], source: RecentActivitySource): RecentActivityItem | null {
    if (rows.length === 0 || rows.some((row) => row.schema_name !== 'core' || typeof row.operation !== 'string' || !['INSERT', 'UPDATE', 'DELETE'].includes(row.operation.toUpperCase()))) return null;
    const timestamp = Math.max(...rows.map((row) => new Date(row.occurred_at).getTime()));
    if (!Number.isFinite(timestamp)) return null;
    const occurredAt = new Date(timestamp).toISOString();
    const actor = this.actorFor(rows, source);
    return this.clientCreate(rows, source, occurredAt, actor)
      ?? this.clientReactivate(rows, source, occurredAt, actor)
      ?? this.clientDeactivate(rows, source, occurredAt, actor)
      ?? this.clientUpdate(rows, source, occurredAt, actor)
      ?? this.providerCreate(rows, source, occurredAt, actor)
      ?? this.providerDeactivate(rows, source, occurredAt, actor)
      ?? this.providerReactivate(rows, source, occurredAt, actor)
      ?? this.providerUpdate(rows, source, occurredAt, actor)
      ?? this.contactCreate(rows, source, occurredAt, actor)
      ?? this.contactDeactivate(rows, source, occurredAt, actor)
      ?? this.contactReactivate(rows, source, occurredAt, actor)
      ?? this.contactUpdate(rows, source, occurredAt, actor)
      ?? this.methodChange(rows, source, occurredAt, actor);
  }

  // A company acquires the CLIENTE role for the first time: either a brand-new company (INSERT
  // empresas + INSERT empresa_roles), or an existing company (any current role, or none) gaining
  // its first CLIENTE membership (plain INSERT empresa_roles, no empresas row at all) — optionally
  // reactivating a previously non-ACTIVO company as a side effect, and optionally seeding fiscal
  // data. This is unambiguous: it only fires on a plain INSERT of the CLIENTE role row itself.
  private clientCreate(rows: SourceRow[], source: RecentActivitySource, occurredAt: string, actor: RecentActivityActor | null): RecentActivityItem | null {
    const roleInserts = rows.filter((row) => row.table_name === 'empresa_roles' && row.operation.toUpperCase() === 'INSERT' && text(row.after_data, 'rol') === 'CLIENTE');
    if (roleInserts.length !== 1) return null;
    const roleRow = roleInserts[0]!;
    const companyId = id(roleRow.after_data, 'empresa_id');
    if (!companyId) return null;
    const others = rows.filter((row) => row !== roleRow);
    const companyRows = others.filter((row) => row.table_name === 'empresas');
    const fiscalRows = others.filter((row) => row.table_name === 'empresas_fiscales' && row.operation.toUpperCase() === 'INSERT');
    if (companyRows.length + fiscalRows.length !== others.length || companyRows.length > 1) return null;
    let insertedName: string | null = null;
    if (companyRows.length === 1) {
      const companyRow = companyRows[0]!;
      const operation = companyRow.operation.toUpperCase();
      if (operation === 'INSERT') {
        if (id(companyRow.after_data, 'empresa_id') !== companyId) return null;
        insertedName = text(companyRow.after_data, 'nombre_comercial');
      } else if (operation === 'UPDATE') {
        if ((id(companyRow.after_data, 'empresa_id') ?? id(companyRow.before_data, 'empresa_id')) !== companyId) return null;
        const meaningful = [...changedFields(companyRow.before_data, companyRow.after_data)].filter((field) => !ignoredTimestampFields.has(field));
        if (meaningful.length !== 1 || meaningful[0] !== 'estatus' || text(companyRow.after_data, 'estatus') !== 'ACTIVO') return null;
      } else return null;
    }
    if (fiscalRows.some((row) => id(row.after_data, 'empresa_id') !== companyId)) return null;
    const entity = insertedName ?? source.companies.get(companyId) ?? null;
    return this.item('CLIENT_CREATED', entity, null, occurredAt, actor);
  }

  // An existing CLIENTE role flips INACTIVO -> ACTIVO. This is unambiguous: it only fires on an
  // UPDATE of a role row that was already CLIENTE and stays CLIENTE, distinguishing it from the
  // plain INSERT above via the actual before/after values rather than which endpoint was called.
  private clientReactivate(rows: SourceRow[], source: RecentActivitySource, occurredAt: string, actor: RecentActivityActor | null): RecentActivityItem | null {
    return this.clientRoleTransition(rows, source, occurredAt, 'INACTIVO', 'ACTIVO', 'CLIENT_REACTIVATED', true, actor);
  }

  // An existing CLIENTE role flips ACTIVO -> INACTIVO. The same request may also flip
  // empresas.estatus to INACTIVO when CLIENTE was the company's last active role; that is folded
  // into this same single activity rather than a second one.
  private clientDeactivate(rows: SourceRow[], source: RecentActivitySource, occurredAt: string, actor: RecentActivityActor | null): RecentActivityItem | null {
    return this.clientRoleTransition(rows, source, occurredAt, 'ACTIVO', 'INACTIVO', 'CLIENT_DEACTIVATED', false, actor);
  }

  private clientRoleTransition(rows: SourceRow[], source: RecentActivitySource, occurredAt: string, from: string, to: string, type: 'CLIENT_REACTIVATED' | 'CLIENT_DEACTIVATED', allowFiscal: boolean, actor: RecentActivityActor | null): RecentActivityItem | null {
    const roleRows = rows.filter((row) => row.table_name === 'empresa_roles');
    if (roleRows.length !== 1) return null;
    const roleRow = roleRows[0]!;
    if (roleRow.operation.toUpperCase() !== 'UPDATE') return null;
    if (text(roleRow.before_data, 'rol') !== 'CLIENTE' || text(roleRow.after_data, 'rol') !== 'CLIENTE') return null;
    if (text(roleRow.before_data, 'estatus') !== from || text(roleRow.after_data, 'estatus') !== to) return null;
    if ([...changedFields(roleRow.before_data, roleRow.after_data)].some((field) => !ignoredTimestampFields.has(field) && field !== 'estatus')) return null;
    const companyId = id(roleRow.after_data, 'empresa_id') ?? id(roleRow.before_data, 'empresa_id');
    if (!companyId) return null;
    const others = rows.filter((row) => row !== roleRow);
    const companyRows = others.filter((row) => row.table_name === 'empresas');
    const fiscalRows = allowFiscal ? others.filter((row) => row.table_name === 'empresas_fiscales' && row.operation.toUpperCase() === 'INSERT') : [];
    if (companyRows.length + fiscalRows.length !== others.length || companyRows.length > 1) return null;
    if (companyRows.length === 1) {
      const companyRow = companyRows[0]!;
      if (companyRow.operation.toUpperCase() !== 'UPDATE') return null;
      if ((id(companyRow.after_data, 'empresa_id') ?? id(companyRow.before_data, 'empresa_id')) !== companyId) return null;
      const meaningful = [...changedFields(companyRow.before_data, companyRow.after_data)].filter((field) => !ignoredTimestampFields.has(field));
      if (meaningful.length !== 1 || meaningful[0] !== 'estatus' || text(companyRow.after_data, 'estatus') !== to) return null;
    }
    if (fiscalRows.some((row) => id(row.after_data, 'empresa_id') !== companyId)) return null;
    const entity = source.companies.get(companyId) ?? null;
    return this.item(type, entity, null, occurredAt, actor);
  }

  // A PATCH to the company's own record and/or its fiscal identity, with no role change at all.
  // These audit rows (empresas.nombre_comercial/observaciones, empresas_fiscales insert/update)
  // are byte-identical to a Provider company-info PATCH — audit.cambios carries no per-request
  // marker naming the workflow that produced them. The only available signal is which roles the
  // company currently holds: a CLIENTE-only company can only have reached this shape through the
  // Clients PATCH (the Providers PATCH 404s without an active provider role, and vice versa), so
  // that is used as the disambiguator. A company that currently holds an active CLIENTE role
  // *and* an active provider role is genuinely ambiguous — this deliberately shows neither
  // CLIENT_UPDATED nor PROVIDER_UPDATED for that shared case rather than guess.
  private clientUpdate(rows: SourceRow[], source: RecentActivitySource, occurredAt: string, actor: RecentActivityActor | null): RecentActivityItem | null {
    const companies = rows.filter((row) => row.table_name === 'empresas' && row.operation.toUpperCase() === 'UPDATE');
    const fiscals = rows.filter((row) => row.table_name === 'empresas_fiscales' && ['INSERT', 'UPDATE'].includes(row.operation.toUpperCase()));
    if (companies.length === 0 && fiscals.length === 0) return null;
    const allowed = rows.every((row) => (row.table_name === 'empresas' && row.operation.toUpperCase() === 'UPDATE')
      || (row.table_name === 'empresas_fiscales' && ['INSERT', 'UPDATE'].includes(row.operation.toUpperCase())));
    if (!allowed) return null;
    if (companies.some((row) => [...changedFields(row.before_data, row.after_data)].some((field) => !ignoredTimestampFields.has(field) && !clientBusinessFields.has(field)))) return null;
    const first = companies[0] ?? fiscals[0]!;
    const companyId = id(first.after_data, 'empresa_id') ?? id(first.before_data, 'empresa_id');
    if (!companyId || rows.some((row) => (id(row.after_data, 'empresa_id') ?? id(row.before_data, 'empresa_id')) !== companyId)) return null;
    const roles = source.companyRoles?.get(companyId);
    if (!roles || !roles.has('CLIENTE') || [...roles].some((role) => providerRoles.has(role))) return null;
    const entity = companies.map((row) => text(row.after_data, 'nombre_comercial')).filter((name): name is string => Boolean(name)).at(-1)
      ?? companies.map((row) => text(row.before_data, 'nombre_comercial')).filter((name): name is string => Boolean(name)).at(-1)
      ?? source.companies.get(companyId) ?? null;
    return this.item('CLIENT_UPDATED', entity, null, occurredAt, actor);
  }

  private providerCreate(rows: SourceRow[], source: RecentActivitySource, occurredAt: string, actor: RecentActivityActor | null): RecentActivityItem | null {
    const companies = rows.filter((row) => row.table_name === 'empresas' && row.operation.toUpperCase() === 'INSERT');
    const roles = rows.filter((row) => row.table_name === 'empresa_roles' && row.operation.toUpperCase() === 'INSERT');
    const fiscals = rows.filter((row) => row.table_name === 'empresas_fiscales' && row.operation.toUpperCase() === 'INSERT');
    if (companies.length !== 1 || roles.length !== 1 || rows.length !== 2 + fiscals.length) return null;
    const companyId = id(companies[0]!.after_data, 'empresa_id');
    if (!companyId || id(roles[0]!.after_data, 'empresa_id') !== companyId || !providerRoles.has(text(roles[0]!.after_data, 'rol') ?? '')) return null;
    if (fiscals.some((row) => id(row.after_data, 'empresa_id') !== companyId)) return null;
    return this.item('PROVIDER_CREATED', text(companies[0]!.after_data, 'nombre_comercial') ?? source.companies.get(companyId) ?? null, null, occurredAt, actor);
  }

  // An existing provider-type role (PROVEEDOR/SERVICIO/FLETE) flips ACTIVO -> INACTIVO. Mirrors
  // clientRoleTransition, generalized to whichever provider role type the company holds — the
  // role itself never changes identity in this transition (only its estatus does), and the same
  // request may also flip empresas.estatus to INACTIVO when this was the company's last active
  // role (see ProvidersRepository.changeStatus, fixed in Phase 9B to be role-aware rather than
  // unconditionally deactivating the whole company).
  private providerDeactivate(rows: SourceRow[], source: RecentActivitySource, occurredAt: string, actor: RecentActivityActor | null): RecentActivityItem | null {
    return this.providerRoleTransition(rows, source, occurredAt, 'ACTIVO', 'INACTIVO', 'PROVIDER_DEACTIVATED', actor);
  }

  // An existing provider-type role flips INACTIVO -> ACTIVO, optionally reactivating the whole
  // company alongside it (same shape, mirrored from the deactivate case above).
  private providerReactivate(rows: SourceRow[], source: RecentActivitySource, occurredAt: string, actor: RecentActivityActor | null): RecentActivityItem | null {
    return this.providerRoleTransition(rows, source, occurredAt, 'INACTIVO', 'ACTIVO', 'PROVIDER_REACTIVATED', actor);
  }

  private providerRoleTransition(rows: SourceRow[], source: RecentActivitySource, occurredAt: string, from: string, to: string, type: 'PROVIDER_DEACTIVATED' | 'PROVIDER_REACTIVATED', actor: RecentActivityActor | null): RecentActivityItem | null {
    const roleRows = rows.filter((row) => row.table_name === 'empresa_roles');
    if (roleRows.length !== 1) return null;
    const roleRow = roleRows[0]!;
    if (roleRow.operation.toUpperCase() !== 'UPDATE') return null;
    const beforeRole = text(roleRow.before_data, 'rol');
    const afterRole = text(roleRow.after_data, 'rol');
    if (!beforeRole || beforeRole !== afterRole || !providerRoles.has(beforeRole)) return null;
    if (text(roleRow.before_data, 'estatus') !== from || text(roleRow.after_data, 'estatus') !== to) return null;
    if ([...changedFields(roleRow.before_data, roleRow.after_data)].some((field) => !ignoredTimestampFields.has(field) && field !== 'estatus')) return null;
    const companyId = id(roleRow.after_data, 'empresa_id') ?? id(roleRow.before_data, 'empresa_id');
    if (!companyId) return null;
    const others = rows.filter((row) => row !== roleRow);
    const companyRows = others.filter((row) => row.table_name === 'empresas');
    if (companyRows.length !== others.length || companyRows.length > 1) return null;
    if (companyRows.length === 1) {
      const companyRow = companyRows[0]!;
      if (companyRow.operation.toUpperCase() !== 'UPDATE') return null;
      if ((id(companyRow.after_data, 'empresa_id') ?? id(companyRow.before_data, 'empresa_id')) !== companyId) return null;
      const meaningful = [...changedFields(companyRow.before_data, companyRow.after_data)].filter((field) => !ignoredTimestampFields.has(field));
      if (meaningful.length !== 1 || meaningful[0] !== 'estatus' || text(companyRow.after_data, 'estatus') !== to) return null;
    }
    const entity = source.companies.get(companyId) ?? null;
    return this.item(type, entity, null, occurredAt, actor);
  }

  private providerUpdate(rows: SourceRow[], source: RecentActivitySource, occurredAt: string, actor: RecentActivityActor | null): RecentActivityItem | null {
    const companies = rows.filter((row) => row.table_name === 'empresas' && row.operation.toUpperCase() === 'UPDATE');
    const fiscals = rows.filter((row) => row.table_name === 'empresas_fiscales' && ['INSERT', 'UPDATE'].includes(row.operation.toUpperCase()));
    const aliases = rows.filter((row) => row.table_name === 'alias_empresa' && ['INSERT', 'UPDATE', 'DELETE'].includes(row.operation.toUpperCase()));
    if (companies.length === 0 && fiscals.length === 0 && aliases.length === 0) return null;
    const allowed = rows.every((row) => (row.table_name === 'empresas' && row.operation.toUpperCase() === 'UPDATE')
      || (row.table_name === 'empresa_roles' && row.operation.toUpperCase() === 'UPDATE')
      || (row.table_name === 'empresas_fiscales' && ['INSERT', 'UPDATE'].includes(row.operation.toUpperCase()))
      || (row.table_name === 'alias_empresa' && ['INSERT', 'UPDATE', 'DELETE'].includes(row.operation.toUpperCase())));
    if (!allowed) return null;
    if (companies.some((row) => [...changedFields(row.before_data, row.after_data)].some((field) => !ignoredTimestampFields.has(field) && !providerBusinessFields.has(field)))) return null;
    const roleRows = rows.filter((row) => row.table_name === 'empresa_roles');
    if (companies.length === 0 && roleRows.length > 0) return null;
    if (roleRows.some((row) => [...changedFields(row.before_data, row.after_data)].some((field) => !ignoredTimestampFields.has(field) && field !== 'rol'))) return null;
    const first = companies[0] ?? fiscals[0] ?? aliases[0]!;
    const companyId = id(first.after_data, 'empresa_id') ?? id(first.before_data, 'empresa_id');
    if (!companyId || rows.some((row) => (id(row.after_data, 'empresa_id') ?? id(row.before_data, 'empresa_id')) !== companyId)) return null;
    if (roleRows.some((row) => !providerRoles.has(text(row.after_data, 'rol') ?? text(row.before_data, 'rol') ?? ''))) return null;
    // Mirror of the clientUpdate() disambiguator: a role row already proves this is a Provider
    // mutation, but a plain company/fiscal-only change (no role row) has the exact same shape as
    // a Client PATCH. Only trust it as Provider activity when the company currently holds an
    // active provider role and no active CLIENTE role; stay silent (as before, when role data is
    // unavailable) rather than guess for a genuinely shared, multi-role company.
    if (roleRows.length === 0) {
      const roles = source.companyRoles?.get(companyId);
      if (roles && (![...roles].some((role) => providerRoles.has(role)) || roles.has('CLIENTE'))) return null;
    }
    const entity = companies.map((row) => text(row.after_data, 'nombre_comercial')).filter((name): name is string => Boolean(name)).at(-1)
      ?? companies.map((row) => text(row.before_data, 'nombre_comercial')).filter((name): name is string => Boolean(name)).at(-1)
      ?? source.companies.get(companyId) ?? null;
    return this.item('PROVIDER_UPDATED', entity, null, occurredAt, actor);
  }

  private contactCreate(rows: SourceRow[], source: RecentActivitySource, occurredAt: string, actor: RecentActivityActor | null): RecentActivityItem | null {
    const contacts = rows.filter((row) => row.table_name === 'contactos' && row.operation.toUpperCase() === 'INSERT');
    const methods = rows.filter((row) => row.table_name === 'medios_contacto' && row.operation.toUpperCase() === 'INSERT');
    if (contacts.length !== 1 || rows.length !== 1 + methods.length) return null;
    const contact = contacts[0]!;
    const contactId = id(contact.after_data, 'contacto_id');
    if (!contactId || methods.some((row) => id(row.after_data, 'contacto_id') !== contactId)) return null;
    const companyId = id(contact.after_data, 'empresa_id') ?? source.contacts.get(contactId)?.company_id ?? null;
    return this.item('CONTACT_CREATED', this.contactLabel(contact.after_data, source, contactId), companyId ? source.companies.get(companyId) ?? null : null, occurredAt, actor);
  }

  // core.contactos.estatus flips ACTIVO -> INACTIVO with nothing else changing. Kept strictly
  // separate from contactUpdate() (which explicitly excludes 'estatus' from contactBusinessFields)
  // so a pure status transition can never be misreported as a descriptive/business-field update.
  private contactDeactivate(rows: SourceRow[], source: RecentActivitySource, occurredAt: string, actor: RecentActivityActor | null): RecentActivityItem | null {
    return this.contactStatusTransition(rows, source, occurredAt, 'ACTIVO', 'INACTIVO', 'CONTACT_DEACTIVATED', actor);
  }

  private contactReactivate(rows: SourceRow[], source: RecentActivitySource, occurredAt: string, actor: RecentActivityActor | null): RecentActivityItem | null {
    return this.contactStatusTransition(rows, source, occurredAt, 'INACTIVO', 'ACTIVO', 'CONTACT_REACTIVATED', actor);
  }

  private contactStatusTransition(rows: SourceRow[], source: RecentActivitySource, occurredAt: string, from: string, to: string, type: 'CONTACT_DEACTIVATED' | 'CONTACT_REACTIVATED', actor: RecentActivityActor | null): RecentActivityItem | null {
    if (rows.length !== 1 || rows[0]!.table_name !== 'contactos' || rows[0]!.operation.toUpperCase() !== 'UPDATE') return null;
    const row = rows[0]!;
    if (text(row.before_data, 'estatus') !== from || text(row.after_data, 'estatus') !== to) return null;
    if ([...changedFields(row.before_data, row.after_data)].some((field) => !ignoredTimestampFields.has(field) && field !== 'estatus')) return null;
    const contactId = id(row.after_data, 'contacto_id') ?? id(row.before_data, 'contacto_id');
    const companyId = id(row.after_data, 'empresa_id') ?? id(row.before_data, 'empresa_id') ?? (contactId ? source.contacts.get(contactId)?.company_id : null) ?? null;
    return this.item(type, this.contactLabel(row.after_data ?? row.before_data, source, contactId), companyId ? source.companies.get(companyId) ?? null : null, occurredAt, actor);
  }

  private contactUpdate(rows: SourceRow[], source: RecentActivitySource, occurredAt: string, actor: RecentActivityActor | null): RecentActivityItem | null {
    if (rows.length !== 1 || rows[0]!.table_name !== 'contactos' || rows[0]!.operation.toUpperCase() !== 'UPDATE') return null;
    const row = rows[0]!;
    const changed = changedFields(row.before_data, row.after_data);
    const meaningful = [...changed].filter((field) => !ignoredTimestampFields.has(field));
    if (meaningful.length === 0 || meaningful.some((field) => !contactBusinessFields.has(field))) return null;
    const contactId = id(row.after_data, 'contacto_id') ?? id(row.before_data, 'contacto_id');
    const companyId = id(row.after_data, 'empresa_id') ?? id(row.before_data, 'empresa_id') ?? (contactId ? source.contacts.get(contactId)?.company_id : null) ?? null;
    return this.item('CONTACT_UPDATED', this.contactLabel(row.after_data ?? row.before_data, source, contactId), companyId ? source.companies.get(companyId) ?? null : null, occurredAt, actor);
  }

  private methodChange(rows: SourceRow[], source: RecentActivitySource, occurredAt: string, actor: RecentActivityActor | null): RecentActivityItem | null {
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
    return this.item(type, entity, context, occurredAt, actor);
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

  private item(type: ActivityType, entity: string | null, context: string | null, occurredAt: string, actor: RecentActivityActor | null): RecentActivityItem | null {
    return entity ? { type, category: categories[type], title: titles[type], entity, context, occurredAt, actor } : null;
  }
}
