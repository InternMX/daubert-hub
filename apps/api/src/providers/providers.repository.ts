import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import type { CreateProviderDto } from './dto/create-provider.dto';
import { FiscalChangeMode, type UpdateProviderDto } from './dto/update-provider.dto';
import { ProviderSortBy, SortOrder, type ListProvidersDto } from './dto/list-providers.dto';

interface CompanyRow extends QueryResultRow {
  empresa_id: string;
  tipo_empresa: string;
  nombre_comercial: string;
  estatus: string;
  observaciones: string | null;
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
}

export interface ListedProvidersRecord {
  total: number;
  providers: ListedProviderRow[];
}

export interface FoundProviderRecord extends ListedProviderRow {
  roles: string[];
}

interface LockedProviderRow extends QueryResultRow {
  empresa_id: string;
  tipo_empresa: string;
  nombre_comercial: string;
  observaciones: string | null;
  roles: string[];
}

interface LockedCompanyRow extends QueryResultRow {
  empresa_id: string;
  tipo_empresa: string;
  nombre_comercial: string;
  observaciones: string | null;
}

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

  async create(input: CreateProviderDto, requestId: string): Promise<CreatedProviderRecord> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await this.setAuditContext(client, requestId);
      const company = await this.insertCompany(client, input);
      await client.query('INSERT INTO core.empresa_roles (empresa_id, rol) VALUES ($1, $2)', [company.empresa_id, input.providerType]);
      const fiscal = input.fiscal ? await this.insertFiscal(client, company.empresa_id, input) : null;
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
      JOIN LATERAL (
        SELECT role.rol
        FROM core.empresa_roles role
        WHERE role.empresa_id = company.empresa_id
          AND role.estatus = 'ACTIVO'
          AND role.rol IN ('PROVEEDOR', 'SERVICIO', 'FLETE')
          AND ($1::text IS NULL OR role.rol = $1)
        ORDER BY CASE WHEN role.rol = company.tipo_empresa THEN 0 ELSE 1 END, role.rol
        LIMIT 1
      ) provider_role ON TRUE
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
    const values = [input.providerType ?? null, input.search ?? null];
    const sortExpression = sortExpressions[input.sortBy] ?? sortExpressions[ProviderSortBy.CommercialName];
    const sortOrder = input.sortOrder === SortOrder.Desc ? 'DESC' : 'ASC';
    const [count] = await this.database.query<{ total: string }>(`SELECT count(*)::int AS total ${filter}`, values);
    const providers = await this.database.query<ListedProviderRow>(`
      SELECT
        company.empresa_id::text AS id,
        company.nombre_comercial AS commercial_name,
        provider_role.rol AS provider_type,
        company.estatus AS status,
        company.observaciones AS notes,
        fiscal.empresa_fiscal_id::text AS fiscal_id,
        fiscal.razon_social AS legal_name,
        fiscal.rfc
      ${filter}
      ORDER BY ${sortExpression} ${sortOrder} NULLS LAST, company.empresa_id
      LIMIT $3 OFFSET $4`, [...values, input.pageSize, (input.page - 1) * input.pageSize]);
    return { total: Number(count?.total ?? 0), providers };
  }

  async findById(id: number): Promise<FoundProviderRecord | null> {
    const [provider] = await this.database.query<FoundProviderRecord>(`
      SELECT
        company.empresa_id::text AS id,
        company.nombre_comercial AS commercial_name,
        provider_role.rol AS provider_type,
        provider_roles.roles,
        company.estatus AS status,
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
      JOIN LATERAL (
        SELECT role.rol
        FROM core.empresa_roles role
        WHERE role.empresa_id = company.empresa_id
          AND role.estatus = 'ACTIVO'
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
      WHERE company.empresa_id = $1`, [id]);
    return provider ?? null;
  }

  async update(id: number, input: UpdateProviderDto, requestId: string): Promise<FoundProviderRecord | null> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await this.setAuditContext(client, requestId);
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
      await this.updateFiscal(client, id, fiscal, input);
      await client.query('COMMIT');
      return this.findById(id);
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the database error. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockProvider(client: PoolClient, id: number): Promise<LockedProviderRow | null> {
    const company = await client.query<LockedCompanyRow>(
      'SELECT empresa_id::text, tipo_empresa, nombre_comercial, observaciones FROM core.empresas WHERE empresa_id = $1 FOR UPDATE', [id]);
    const row = company.rows[0];
    if (!row) return null;
    const roles = await client.query<{ rol: string }>(`
      SELECT rol FROM core.empresa_roles WHERE empresa_id = $1 AND estatus = 'ACTIVO'
      ORDER BY CASE rol WHEN 'PROVEEDOR' THEN 1 WHEN 'SERVICIO' THEN 2 WHEN 'FLETE' THEN 3 WHEN 'CLIENTE' THEN 4 WHEN 'OTRO' THEN 5 END`, [id]);
    const activeRoles = roles.rows.map((role) => role.rol);
    if (!activeRoles.some((role) => ['PROVEEDOR', 'SERVICIO', 'FLETE'].includes(role))) return null;
    return { ...row, roles: activeRoles };
  }

  private async lockCurrentFiscal(client: PoolClient, id: number): Promise<LockedFiscalRow | null> {
    const result = await client.query<LockedFiscalRow>(`
      SELECT empresa_fiscal_id::text, razon_social, rfc, fecha_inicio::text, fecha_fin::text
      FROM core.empresas_fiscales WHERE empresa_id = $1 AND es_vigente = TRUE
      ORDER BY fecha_inicio DESC NULLS LAST, empresa_fiscal_id DESC LIMIT 1 FOR UPDATE`, [id]);
    return result.rows[0] ?? null;
  }

  private async updateFiscal(client: PoolClient, id: number, current: LockedFiscalRow | null, input: UpdateProviderDto): Promise<void> {
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

  private async setAuditContext(client: PoolClient, requestId: string): Promise<void> {
    await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']);
    await client.query("SELECT set_config('app.request_id', $1, true)", [requestId]);
  }

  private async insertCompany(client: PoolClient, input: CreateProviderDto): Promise<CompanyRow> {
    const result = await client.query<CompanyRow>(
      'INSERT INTO core.empresas (tipo_empresa, nombre_comercial, observaciones) VALUES ($1, $2, $3) RETURNING empresa_id, tipo_empresa, nombre_comercial, estatus, observaciones, created_at, updated_at',
      [input.providerType, input.commercialName, input.notes ?? null]
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
