import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import type { AuditIdentity } from '../common/authenticated-request';
import { replaceCompanyAliases } from '../companies/company-aliases.repository';
import { insertPaymentNotificationSettings, syncPaymentNotificationDestination } from '../payment-notification-settings/payment-notification-settings.repository';
import type { CreateProviderDto } from './dto/create-provider.dto';
import { FiscalChangeMode, type UpdateProviderDto } from './dto/update-provider.dto';
import { ProviderSortBy, ProviderStatusFilter, SortOrder, type ListProvidersDto } from './dto/list-providers.dto';

interface CompanyRow extends QueryResultRow {
  empresa_id: string;
  tipo_empresa: string;
  nombre_comercial: string;
  estatus: string;
  observaciones: string | null;
  ruta_dropbox: string | null;
}

interface FiscalRow extends QueryResultRow {
  empresa_fiscal_id: string;
  razon_social: string;
  rfc: string;
}

export interface CreatedProviderRecord {
  company: CompanyRow;
  fiscal: FiscalRow | null;
}

interface ListedProviderRow extends QueryResultRow {
  id: string;
  commercial_name: string;
  provider_type: string;
  status: string;
  notes: string | null;
  fiscal_id: string | null;
  legal_name: string | null;
  rfc: string | null;
  matched_alias: string | null;
}

export interface ListedProvidersRecord {
  total: number;
  providers: ListedProviderRow[];
}

export interface FoundProviderRecord extends ListedProviderRow {
  dropbox_path: string | null;
  roles: string[];
  aliases: string[];
  other_aliases: Array<{ alias: string; type: string }>;
}

interface LockedProviderRow extends QueryResultRow {
  empresa_id: string;
  tipo_empresa: string;
  nombre_comercial: string;
  observaciones: string | null;
  estatus: string;
  ruta_dropbox: string | null;
  roles: string[];
}

interface LockedCompanyRow extends QueryResultRow {
  empresa_id: string;
  tipo_empresa: string;
  nombre_comercial: string;
  observaciones: string | null;
  estatus: string;
  ruta_dropbox: string | null;
}

interface RoleRow extends QueryResultRow {
  rol: string;
  estatus: string;
}

// A company holds at most one PROVEEDOR/SERVICIO/FLETE role row at a time
// (create() inserts exactly one; update()'s type-change path UPDATEs that
// same row's `rol` in place rather than adding a second) — so "the" provider
// role is unambiguous. Mirrors core.empresa_roles' actual provider-type
// values; do not add to this set without a corresponding schema change.
const PROVIDER_ROLE_TYPES = new Set(['PROVEEDOR', 'SERVICIO', 'FLETE']);

interface LockedFiscalRow extends FiscalRow {
  fecha_inicio: string | null;
  fecha_fin: string | null;
}

const sortExpressions: Record<ProviderSortBy, string> = {
  [ProviderSortBy.CommercialName]: 'lower(btrim(company.nombre_comercial))',
  [ProviderSortBy.ProviderType]: "CASE provider_role.rol WHEN 'PROVEEDOR' THEN 1 WHEN 'SERVICIO' THEN 2 WHEN 'FLETE' THEN 3 END",
  [ProviderSortBy.LegalName]: 'lower(btrim(fiscal.razon_social))'
};

@Injectable()
export class ProvidersRepository {
  constructor(private readonly database: DatabaseService) {}

  async create(input: CreateProviderDto, requestId: string, identity: AuditIdentity): Promise<CreatedProviderRecord> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await this.setAuditContext(client, requestId, identity);
      const company = await this.insertCompany(client, input);
      await client.query('INSERT INTO core.empresa_roles (empresa_id, rol) VALUES ($1, $2)', [company.empresa_id, input.providerType]);
      const fiscal = input.fiscal ? await this.insertFiscal(client, company.empresa_id, input) : null;
      // Same transaction: a failure here rolls the whole company back (no half-created provider).
      // Safe defaults: procesa=false, activas=false; never activated automatically.
      await insertPaymentNotificationSettings(client, company.empresa_id, company.ruta_dropbox);
      await client.query('COMMIT');
      return { company, fiscal };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original database error when rollback is unavailable.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async list(input: ListProvidersDto): Promise<ListedProvidersRecord> {
    const filter = `
      FROM core.empresas company
      LEFT JOIN LATERAL (
        SELECT empresa_fiscal_id, razon_social, rfc
        FROM core.empresas_fiscales
        WHERE empresa_id = company.empresa_id AND es_vigente = TRUE
        ORDER BY fecha_inicio DESC NULLS LAST, empresa_fiscal_id DESC
        LIMIT 1
      ) fiscal ON TRUE
      -- Keep inactive provider roles discoverable; the selected role's status
      -- is authoritative for provider filtering and presentation.
       JOIN LATERAL (
        SELECT role.rol, role.estatus
        FROM core.empresa_roles role
        WHERE role.empresa_id = company.empresa_id
          AND role.rol IN ('PROVEEDOR', 'SERVICIO', 'FLETE')
          AND ($1::text IS NULL OR role.rol = $1)
        ORDER BY CASE WHEN role.rol = company.tipo_empresa THEN 0 ELSE 1 END, role.rol
        LIMIT 1
       ) provider_role ON TRUE
        AND company.estatus <> 'BLOQUEADO'
        AND (
          (provider_role.estatus = 'ACTIVO' AND $3::text IN ('ACTIVO', 'ALL'))
          OR (provider_role.estatus = 'INACTIVO' AND $3::text IN ('INACTIVO', 'ALL'))
        )
        AND (
          $2::text IS NULL
           OR lower(btrim(company.nombre_comercial)) LIKE '%' || lower($2) || '%'
           OR lower(btrim(fiscal.razon_social)) LIKE '%' || lower($2) || '%'
           OR lower(btrim(fiscal.rfc)) LIKE '%' || lower($2) || '%'
           OR EXISTS (
             SELECT 1
             FROM core.alias_empresa alias
             WHERE alias.empresa_id = company.empresa_id
               AND alias.estatus = 'ACTIVO'
               AND lower(btrim(alias.alias_normalizado)) LIKE '%' || lower($2) || '%'
           )
         )`;
    const values = [input.providerType ?? null, input.search ?? null, input.status ?? ProviderStatusFilter.Active];
    const sortExpression = sortExpressions[input.sortBy] ?? sortExpressions[ProviderSortBy.CommercialName];
    const sortOrder = input.sortOrder === SortOrder.Desc ? 'DESC' : 'ASC';
    const [count] = await this.database.query<{ total: string }>(`SELECT count(*)::int AS total ${filter}`, values);
    const providers = await this.database.query<ListedProviderRow>(`
      SELECT
        company.empresa_id::text AS id,
        company.nombre_comercial AS commercial_name,
        provider_role.rol AS provider_type,
        CASE WHEN company.estatus = 'BLOQUEADO' THEN 'BLOQUEADO' ELSE provider_role.estatus END AS status,
        company.observaciones AS notes,
        fiscal.empresa_fiscal_id::text AS fiscal_id,
        fiscal.razon_social AS legal_name,
        fiscal.rfc,
        CASE WHEN $2::text IS NULL OR lower(btrim(company.nombre_comercial)) LIKE '%' || lower($2) || '%' THEN NULL ELSE (
          SELECT alias.alias
          FROM core.alias_empresa alias
          WHERE alias.empresa_id = company.empresa_id
            AND alias.estatus = 'ACTIVO'
            AND lower(btrim(alias.alias_normalizado)) LIKE '%' || lower($2) || '%'
          ORDER BY
            CASE WHEN lower(btrim(alias.alias_normalizado)) = lower($2) THEN 0 ELSE 1 END,
            CASE WHEN lower(btrim(alias.alias_normalizado)) LIKE lower($2) || '%' THEN 0 ELSE 1 END,
            length(btrim(alias.alias_normalizado)),
            lower(btrim(alias.alias_normalizado)),
            alias.alias
          LIMIT 1
        ) END AS matched_alias
      ${filter}
      ORDER BY ${sortExpression} ${sortOrder} NULLS LAST, company.empresa_id
       LIMIT $4 OFFSET $5`, [...values, input.pageSize, (input.page - 1) * input.pageSize]);
    return { total: Number(count?.total ?? 0), providers };
  }

  async findById(id: string): Promise<FoundProviderRecord | null> {
    const [provider] = await this.database.query<FoundProviderRecord>(`
      SELECT
        company.empresa_id::text AS id,
        company.nombre_comercial AS commercial_name,
        provider_role.rol AS provider_type,
        company.ruta_dropbox AS dropbox_path,
        COALESCE(provider_roles.roles, ARRAY[]::text[]) AS roles,
        COALESCE(company_aliases.aliases, ARRAY[]::text[]) AS aliases,
        COALESCE(other_company_aliases.aliases, '[]'::jsonb) AS other_aliases,
        CASE WHEN company.estatus = 'BLOQUEADO' THEN 'BLOQUEADO' ELSE provider_role.estatus END AS status,
        company.observaciones AS notes,
        fiscal.empresa_fiscal_id::text AS fiscal_id,
        fiscal.razon_social AS legal_name,
        fiscal.rfc
      FROM core.empresas company
      LEFT JOIN LATERAL (
        SELECT empresa_fiscal_id, razon_social, rfc
        FROM core.empresas_fiscales
        WHERE empresa_id = company.empresa_id AND es_vigente = TRUE
        ORDER BY fecha_inicio DESC NULLS LAST, empresa_fiscal_id DESC
        LIMIT 1
      ) fiscal ON TRUE
      -- Keep inactive provider roles discoverable in detail and status changes.
      JOIN LATERAL (
        SELECT role.rol, role.estatus
        FROM core.empresa_roles role
        WHERE role.empresa_id = company.empresa_id
          AND role.rol IN ('PROVEEDOR', 'SERVICIO', 'FLETE')
        ORDER BY CASE WHEN role.rol = company.tipo_empresa THEN 0 ELSE 1 END, role.rol
        LIMIT 1
      ) provider_role ON TRUE
      JOIN LATERAL (
        SELECT array_agg(role.rol ORDER BY CASE role.rol WHEN 'PROVEEDOR' THEN 1 WHEN 'SERVICIO' THEN 2 WHEN 'FLETE' THEN 3 WHEN 'CLIENTE' THEN 4 WHEN 'OTRO' THEN 5 ELSE 6 END, role.rol) AS roles
        FROM core.empresa_roles role
        WHERE role.empresa_id = company.empresa_id
          AND role.estatus = 'ACTIVO'
      ) provider_roles ON TRUE
      LEFT JOIN LATERAL (
        SELECT array_agg(alias.alias ORDER BY lower(btrim(alias.alias)), alias.alias_id) AS aliases
        FROM core.alias_empresa alias
        WHERE alias.empresa_id = company.empresa_id
          AND alias.tipo_alias = 'NOMBRE_COMERCIAL_ALTERNATIVO'
          AND alias.estatus = 'ACTIVO'
      ) company_aliases ON TRUE
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('alias', alias.alias, 'type', alias.tipo_alias)
          ORDER BY lower(btrim(alias.alias)), alias.tipo_alias, alias.alias_id) AS aliases
        FROM core.alias_empresa alias
        WHERE alias.empresa_id = company.empresa_id
          AND alias.tipo_alias <> 'NOMBRE_COMERCIAL_ALTERNATIVO'
          AND alias.estatus = 'ACTIVO'
      ) other_company_aliases ON TRUE
      WHERE company.empresa_id = $1`, [id]);
    return provider ?? null;
  }

  async update(id: string, input: UpdateProviderDto, requestId: string, identity: AuditIdentity): Promise<FoundProviderRecord | null> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await this.setAuditContext(client, requestId, identity);
      const company = await this.lockProvider(client, id);
      if (!company) {
        await client.query('COMMIT');
        return null;
      }
      const fiscal = await this.lockCurrentFiscal(client, id);
      if (input.providerType && input.providerType !== company.tipo_empresa) {
        const providerRoles = company.roles.filter((role) => ['PROVEEDOR', 'SERVICIO', 'FLETE'].includes(role));
        if (providerRoles.length !== 1) {
          throw Object.assign(new Error('MULTI_ROLE_PROVIDER'), { code: 'MULTI_ROLE_PROVIDER' });
        }
        await client.query('UPDATE core.empresas SET tipo_empresa = $1 WHERE empresa_id = $2', [input.providerType, id]);
        await client.query('UPDATE core.empresa_roles SET rol = $1 WHERE empresa_id = $2 AND rol = $3', [input.providerType, id, providerRoles[0]]);
      }
      if (input.commercialName !== undefined || input.notes !== undefined) {
        const values: unknown[] = [];
        const sets: string[] = [];
        if (input.commercialName !== undefined) { values.push(input.commercialName); sets.push(`nombre_comercial = $${values.length}`); }
        if (input.notes !== undefined) { values.push(input.notes); sets.push(`observaciones = $${values.length}`); }
        values.push(id);
        await client.query(`UPDATE core.empresas SET ${sets.join(', ')} WHERE empresa_id = $${values.length}`, values);
      }
      if (input.rutaDropbox !== undefined) await this.updateDropboxPath(client, id, company.ruta_dropbox, input.rutaDropbox);
      await this.updateFiscal(client, id, fiscal, input);
      if (input.aliases !== undefined) await replaceCompanyAliases(client, id, input.aliases);
      await client.query('COMMIT');
      return this.findById(id);
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the database error. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  // Role-aware by design, mirroring ClientsRepository.changeStatus(): a
  // multi-role company (e.g. active PROVEEDOR + active CLIENTE) must not
  // have its OTHER active roles silently deactivated as a side effect of
  // deactivating just the provider role, and core.empresas.estatus must
  // stay ACTIVO as long as at least one role does. Confirmed via Phase 9A
  // that the previous implementation flipped the whole company's estatus
  // regardless of other active roles — this was the confirmed defect this
  // method now fixes.
  async changeStatus(id: string, targetStatus: 'ACTIVO' | 'INACTIVO', requestId: string, identity: AuditIdentity): Promise<FoundProviderRecord | null> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await this.setAuditContext(client, requestId, identity);
      const company = await this.lockCompanyRow(client, id);
      if (!company) { await client.query('COMMIT'); return null; }
      if (company.estatus === 'BLOQUEADO') throw Object.assign(new Error('PROVIDER_STATUS_NOT_MANAGEABLE'), { code: 'PROVIDER_STATUS_NOT_MANAGEABLE' });
      const roles = await this.lockRoles(client, id);
      const providerRole = roles.find((role) => PROVIDER_ROLE_TYPES.has(role.rol));
      // No provider-type role row at all (active or not) — this company was
      // never a provider; matches the pre-existing "not found" behavior.
      if (!providerRole) { await client.query('COMMIT'); return null; }

      if (targetStatus === 'INACTIVO') {
        if (providerRole.estatus !== 'ACTIVO') throw Object.assign(new Error('PROVIDER_ALREADY_INACTIVE'), { code: 'PROVIDER_ALREADY_INACTIVE' });
        await client.query('UPDATE core.empresa_roles SET estatus = $1 WHERE empresa_id = $2 AND rol = $3', ['INACTIVO', id, providerRole.rol]);
        // Only cascade to the whole company when no OTHER role (e.g. CLIENTE)
        // is still active — a multi-role company stays ACTIVO otherwise.
        const otherRoleStillActive = roles.some((role) => role.rol !== providerRole.rol && role.estatus === 'ACTIVO');
        if (!otherRoleStillActive) {
          await client.query('UPDATE core.empresas SET estatus = $1 WHERE empresa_id = $2', ['INACTIVO', id]);
        }
      } else {
        if (providerRole.estatus === 'ACTIVO' && company.estatus === 'ACTIVO') {
          throw Object.assign(new Error('PROVIDER_ALREADY_ACTIVE'), { code: 'PROVIDER_ALREADY_ACTIVE' });
        }
        if (company.estatus !== 'ACTIVO') {
          await client.query('UPDATE core.empresas SET estatus = $1 WHERE empresa_id = $2', ['ACTIVO', id]);
        }
        await client.query('UPDATE core.empresa_roles SET estatus = $1 WHERE empresa_id = $2 AND rol = $3', ['ACTIVO', id, providerRole.rol]);
      }
      await client.query('COMMIT');
      return this.findById(id);
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the database error. */ }
      throw error;
    } finally { client.release(); }
  }

  // ruta_dropbox and ruta_destino change together in the caller's transaction. The path arrives already
  // validated/canonicalized by ProvidersService. Clearing it while Payment Notifications are active
  // would leave n8n with an active company and no Dropbox path, so that is refused.
  private async updateDropboxPath(client: PoolClient, id: string, current: string | null, next: string | null): Promise<void> {
    if ((current ?? null) === (next ?? null)) return;
    if (next === null) {
      const active = await client.query('SELECT 1 FROM core.empresas_notificacion_pago WHERE empresa_id = $1 AND notificaciones_activas = TRUE', [id]);
      if (active.rows.length > 0) throw Object.assign(new Error('PAYMENT_NOTIFICATIONS_DROPBOX_PATH_IN_USE'), { code: 'PAYMENT_NOTIFICATIONS_DROPBOX_PATH_IN_USE' });
    }
    await client.query('UPDATE core.empresas SET ruta_dropbox = $1 WHERE empresa_id = $2', [next, id]);
    await syncPaymentNotificationDestination(client, id, next);
  }

  private async lockProvider(client: PoolClient, id: string): Promise<LockedProviderRow | null> {
    const company = await client.query<LockedCompanyRow>(
      'SELECT empresa_id::text, tipo_empresa, nombre_comercial, observaciones, estatus, ruta_dropbox FROM core.empresas WHERE empresa_id = $1 FOR UPDATE', [id]);
    const row = company.rows[0];
    if (!row) return null;
    const roles = await client.query<{ rol: string }>(`
      SELECT rol FROM core.empresa_roles WHERE empresa_id = $1 AND estatus = 'ACTIVO'
      ORDER BY CASE rol WHEN 'PROVEEDOR' THEN 1 WHEN 'SERVICIO' THEN 2 WHEN 'FLETE' THEN 3 WHEN 'CLIENTE' THEN 4 WHEN 'OTRO' THEN 5 END`, [id]);
    const activeRoles = roles.rows.map((role) => role.rol);
    if (!activeRoles.some((role) => ['PROVEEDOR', 'SERVICIO', 'FLETE'].includes(role))) return null;
    return { ...row, roles: activeRoles };
  }

  // Plain company row, no role join/filter — used by changeStatus(), which
  // must be able to find and lock a company regardless of whether its
  // provider role is currently active (mirrors ClientsRepository.lockCompany).
  private async lockCompanyRow(client: PoolClient, id: string): Promise<LockedCompanyRow | null> {
    const result = await client.query<LockedCompanyRow>(
      'SELECT empresa_id::text, tipo_empresa, nombre_comercial, observaciones, estatus, ruta_dropbox FROM core.empresas WHERE empresa_id = $1 FOR UPDATE', [id]);
    return result.rows[0] ?? null;
  }

  // ALL role rows regardless of estatus — used by changeStatus() to find the
  // provider role in either state and to check whether any OTHER role is
  // still active before cascading to core.empresas.estatus (mirrors
  // ClientsRepository.lockRoles()).
  private async lockRoles(client: PoolClient, id: string): Promise<RoleRow[]> {
    const result = await client.query<RoleRow>('SELECT rol, estatus FROM core.empresa_roles WHERE empresa_id = $1 FOR UPDATE', [id]);
    return result.rows;
  }

  private async lockCurrentFiscal(client: PoolClient, id: string): Promise<LockedFiscalRow | null> {
    const result = await client.query<LockedFiscalRow>(`
      SELECT empresa_fiscal_id::text, razon_social, rfc, fecha_inicio::text, fecha_fin::text
      FROM core.empresas_fiscales WHERE empresa_id = $1 AND es_vigente = TRUE
      ORDER BY fecha_inicio DESC NULLS LAST, empresa_fiscal_id DESC LIMIT 1 FOR UPDATE`, [id]);
    return result.rows[0] ?? null;
  }

  private async updateFiscal(client: PoolClient, id: string, current: LockedFiscalRow | null, input: UpdateProviderDto): Promise<void> {
    const fiscal = input.fiscal;
    if (!fiscal) return;
    const legalName = fiscal.legalName?.trim() ?? '';
    const rfc = fiscal.rfc?.trim() ?? '';
    if (!current) {
      if (!legalName && !rfc) return;
      if (!legalName || !rfc) return;
      await client.query('INSERT INTO core.empresas_fiscales (empresa_id, razon_social, rfc, es_vigente) VALUES ($1, $2, $3, TRUE)', [id, legalName, rfc]);
      return;
    }
    if (!legalName && !rfc) throw Object.assign(new Error('FISCAL_REMOVAL_NOT_ALLOWED'), { code: 'FISCAL_REMOVAL_NOT_ALLOWED' });
    if (!legalName || !rfc) return;
    if (rfc === current.rfc) {
      if (legalName !== current.razon_social) await client.query('UPDATE core.empresas_fiscales SET razon_social = $1 WHERE empresa_fiscal_id = $2', [legalName, current.empresa_fiscal_id]);
      return;
    }
    if (!fiscal.changeMode) throw Object.assign(new Error('FISCAL_CHANGE_MODE_REQUIRED'), { code: 'FISCAL_CHANGE_MODE_REQUIRED' });
    if (fiscal.changeMode === FiscalChangeMode.Correction) {
      await client.query('UPDATE core.empresas_fiscales SET razon_social = $1, rfc = $2 WHERE empresa_fiscal_id = $3', [legalName, rfc, current.empresa_fiscal_id]);
      return;
    }
    await client.query('UPDATE core.empresas_fiscales SET es_vigente = FALSE, fecha_fin = $1 WHERE empresa_fiscal_id = $2', [fiscal.effectiveStartDate, current.empresa_fiscal_id]);
    await client.query('INSERT INTO core.empresas_fiscales (empresa_id, razon_social, rfc, es_vigente, fecha_inicio) VALUES ($1, $2, $3, TRUE, $4)', [id, legalName, rfc, fiscal.effectiveStartDate]);
  }

  private async setAuditContext(client: PoolClient, requestId: string, identity: AuditIdentity): Promise<void> {
    await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']);
    await client.query("SELECT set_config('app.request_id', $1, true)", [requestId]);
    await client.query("SELECT set_config('app.user_id', COALESCE($1, ''), true)", [identity.userId]);
    await client.query("SELECT set_config('app.user_email', COALESCE($1, ''), true)", [identity.userEmail]);
  }

  private async insertCompany(client: PoolClient, input: CreateProviderDto): Promise<CompanyRow> {
    const result = await client.query<CompanyRow>(
      'INSERT INTO core.empresas (tipo_empresa, nombre_comercial, observaciones, ruta_dropbox) VALUES ($1, $2, $3, $4) RETURNING empresa_id, tipo_empresa, nombre_comercial, estatus, observaciones, ruta_dropbox, created_at, updated_at',
      [input.providerType, input.commercialName, input.notes ?? null, input.rutaDropbox ?? null]
    );
    return result.rows[0]!;
  }

  private async insertFiscal(client: PoolClient, companyId: string, input: CreateProviderDto): Promise<FiscalRow> {
    const fiscal = input.fiscal!;
    const result = await client.query<FiscalRow>(
      'INSERT INTO core.empresas_fiscales (empresa_id, razon_social, rfc, es_vigente) VALUES ($1, $2, $3, TRUE) RETURNING empresa_fiscal_id, razon_social, rfc',
      [companyId, fiscal.legalName, fiscal.rfc]
    );
    return result.rows[0]!;
  }
}
