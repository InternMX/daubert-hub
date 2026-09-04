import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';

type Snapshot = Record<string, unknown> | null;

interface AuditRow extends QueryResultRow {
  request_id: string;
  schema_name: string;
  table_name: string;
  operation: string;
  before_data: Snapshot;
  after_data: Snapshot;
  occurred_at: Date | string;
}

interface ContactLabelRow extends QueryResultRow {
  id: string;
  company_id: string;
  contact_type: string;
  name: string | null;
  area: string | null;
}

interface CompanyLabelRow extends QueryResultRow {
  id: string;
  name: string;
}

export interface RecentActivitySource {
  rows: AuditRow[];
  contacts: Map<string, ContactLabelRow>;
  companies: Map<string, string>;
  companyRoles: Map<string, Set<string>>;
}

export type AuditActivityCategory = 'PROVIDER' | 'CONTACT' | 'CLIENT';

function snapshotId(snapshot: Snapshot, key: string): string | null {
  const value = snapshot?.[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

@Injectable()
export class RecentActivityRepository {
  constructor(private readonly database: DatabaseService) {}

  async findRecent(limit: number, category?: AuditActivityCategory): Promise<RecentActivitySource> {
    const categoryTables = category === 'PROVIDER'
      ? ['empresas', 'empresa_roles', 'empresas_fiscales', 'alias_empresa']
      : category === 'CONTACT' ? ['contactos', 'medios_contacto']
      : category === 'CLIENT' ? ['empresas', 'empresa_roles', 'empresas_fiscales'] : null;
    const categoryCondition = categoryTables
      ? "HAVING bool_or(schema_name = 'core' AND table_name = ANY($2::text[]))"
      : '';
    const rows = await this.database.query<AuditRow>(`
      WITH normalized AS (
        SELECT
          change.request_id,
          change.esquema AS schema_name,
          change.tabla AS table_name,
          change.operacion AS operation,
          change.datos_anteriores AS before_data,
          change.datos_nuevos AS after_data,
          change.fecha AS occurred_at,
          change.cambio_id AS audit_id
        FROM audit.cambios change
        WHERE change.origen = 'DAUBERT_HUB'
          AND change.request_id IS NOT NULL
      ), recent_requests AS (
        SELECT request_id, max(occurred_at) AS request_occurred_at
        FROM normalized
        GROUP BY request_id
        ${categoryCondition}
        ORDER BY request_occurred_at DESC, request_id DESC
        LIMIT $1
      )
      SELECT normalized.request_id, normalized.schema_name, normalized.table_name, normalized.operation,
        normalized.before_data, normalized.after_data, normalized.occurred_at
      FROM recent_requests
      JOIN normalized USING (request_id)
      ORDER BY recent_requests.request_occurred_at DESC, request_id DESC,
        normalized.occurred_at, normalized.audit_id`, categoryTables ? [limit * 5, categoryTables] : [limit * 5]);

    const contactIds = new Set<string>();
    const companyIds = new Set<string>();
    for (const row of rows) {
      for (const snapshot of [row.after_data, row.before_data]) {
        const contactId = snapshotId(snapshot, 'contacto_id');
        const companyId = snapshotId(snapshot, 'empresa_id');
        if (contactId) contactIds.add(contactId);
        if (companyId) companyIds.add(companyId);
      }
    }

    const contacts = contactIds.size === 0 ? [] : await this.database.query<ContactLabelRow>(`
      SELECT contacto_id::text AS id, empresa_id::text AS company_id, tipo_contacto AS contact_type,
        nombre AS name, area
      FROM core.contactos
      WHERE contacto_id = ANY($1::bigint[])`, [[...contactIds]]);
    for (const contact of contacts) companyIds.add(contact.company_id);

    const companies = companyIds.size === 0 ? [] : await this.database.query<CompanyLabelRow>(`
      SELECT empresa_id::text AS id, nombre_comercial AS name
      FROM core.empresas
      WHERE empresa_id = ANY($1::bigint[])`, [[...companyIds]]);

    // Current active-role membership per company. This lets the service tell apart audit rows
    // that are structurally identical between the Clients and Providers PATCH workflows (a plain
    // empresas/empresas_fiscales change carries no per-request workflow marker) without guessing
    // from anything other than what actually holds true for that company right now.
    const roleRows = companyIds.size === 0 ? [] : await this.database.query<{ empresa_id: string; rol: string }>(`
      SELECT empresa_id::text AS empresa_id, rol
      FROM core.empresa_roles
      WHERE empresa_id = ANY($1::bigint[]) AND estatus = 'ACTIVO'`, [[...companyIds]]);
    const companyRoles = new Map<string, Set<string>>();
    for (const companyId of companyIds) companyRoles.set(companyId, new Set());
    for (const roleRow of roleRows) companyRoles.get(roleRow.empresa_id)?.add(roleRow.rol);

    return {
      rows,
      contacts: new Map(contacts.map((contact) => [contact.id, contact])),
      companies: new Map(companies.map((company) => [company.id, company.name])),
      companyRoles
    };
  }
}
