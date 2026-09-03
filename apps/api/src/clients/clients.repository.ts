import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import { FiscalChangeMode } from '../providers/dto/update-provider.dto';
import type { CreateClientDto } from './dto/create-client.dto';
import type { ListClientsDto } from './dto/list-clients.dto';
import type { UpdateClientDto } from './dto/update-client.dto';

export interface AuditIdentity {
  userId: string | null;
  userEmail: string | null;
}

export interface ClientRow extends QueryResultRow {
  id: string;
  commercial_name: string;
  company_type: string;
  status: string;
  notes: string | null;
  fiscal_id: string | null;
  legal_name: string | null;
  rfc: string | null;
  fiscal_start_date: string | null;
  fiscal_end_date: string | null;
  roles: string[];
}

export interface ListedClientsRecord {
  total: number;
  clients: ClientRow[];
}

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
  fecha_inicio: string | null;
  fecha_fin: string | null;
}

interface RoleRow extends QueryResultRow {
  rol: string;
  estatus: string;
}

const clientSelect = `company.empresa_id::text AS id, company.nombre_comercial AS commercial_name,
  company.tipo_empresa AS company_type, company.estatus AS status, company.observaciones AS notes,
  fiscal.empresa_fiscal_id::text AS fiscal_id, fiscal.razon_social AS legal_name, fiscal.rfc,
  fiscal.fecha_inicio::text AS fiscal_start_date, fiscal.fecha_fin::text AS fiscal_end_date,
  COALESCE(roles.roles, ARRAY[]::text[]) AS roles`;

const clientJoins = `LEFT JOIN LATERAL (
    SELECT empresa_fiscal_id, razon_social, rfc, fecha_inicio, fecha_fin
    FROM core.empresas_fiscales WHERE empresa_id = company.empresa_id AND es_vigente = TRUE
    ORDER BY fecha_inicio DESC NULLS LAST, empresa_fiscal_id DESC LIMIT 1
  ) fiscal ON TRUE
  JOIN LATERAL (
    SELECT array_agg(role.rol ORDER BY CASE role.rol WHEN 'PROVEEDOR' THEN 1 WHEN 'SERVICIO' THEN 2 WHEN 'FLETE' THEN 3 WHEN 'CLIENTE' THEN 4 WHEN 'OTRO' THEN 5 ELSE 6 END, role.rol) AS roles
    FROM core.empresa_roles role WHERE role.empresa_id = company.empresa_id AND role.estatus = 'ACTIVO'
  ) roles ON TRUE`;

@Injectable()
export class ClientsRepository {
  constructor(private readonly database: DatabaseService) {}

  async list(input: ListClientsDto): Promise<ListedClientsRecord> {
    const filter = `FROM core.empresas company ${clientJoins}
      WHERE company.estatus = 'ACTIVO'
        AND 'CLIENTE' = ANY(roles.roles)
        AND ($1::text IS NULL OR lower(btrim(company.nombre_comercial)) LIKE '%' || lower($1) || '%'
          OR lower(btrim(fiscal.razon_social)) LIKE '%' || lower($1) || '%'
          OR lower(btrim(fiscal.rfc)) LIKE '%' || lower($1) || '%')`;
    const [count] = await this.database.query<{ total: string }>(`SELECT count(*)::int AS total ${filter}`, [input.search ?? null]);
    const direction = input.sortOrder === 'desc' ? 'DESC' : 'ASC';
    const clients = await this.database.query<ClientRow>(`SELECT ${clientSelect} ${filter}
      ORDER BY lower(btrim(company.nombre_comercial)) ${direction}, company.empresa_id
      LIMIT $2 OFFSET $3`, [input.search ?? null, input.pageSize, (input.page - 1) * input.pageSize]);
    return { total: Number(count?.total ?? 0), clients };
  }

  async findActiveById(id: string): Promise<ClientRow | null> {
    const rows = await this.database.query<ClientRow>(`SELECT ${clientSelect} FROM core.empresas company ${clientJoins}
      WHERE company.empresa_id = $1 AND company.estatus = 'ACTIVO' AND 'CLIENTE' = ANY(roles.roles)`, [id]);
    return rows[0] ?? null;
  }

  async create(input: CreateClientDto, requestId: string, identity: AuditIdentity): Promise<ClientRow> {
    return this.transaction(requestId, identity, async (client) => {
      const byName = await this.lockCompanyByName(client, input.commercialName);
      const byRfc = input.fiscal ? await this.lockCompanyByRfc(client, input.fiscal.rfc) : null;

      if (byRfc && (!byName || byRfc.empresa_id !== byName.empresa_id)) this.fail('CLIENT_RFC_CONFLICT');
      if (byName) {
        const roles = await this.lockRoles(client, byName.empresa_id);
        if (roles.some((role) => role.rol === 'CLIENTE' && role.estatus === 'ACTIVO')) this.fail('CLIENT_ALREADY_ACTIVE');
        const fiscal = await this.lockCurrentFiscal(client, byName.empresa_id);
        if (input.fiscal && fiscal && this.normalizeRfc(fiscal.rfc) !== input.fiscal.rfc) this.fail('CLIENT_NAME_RFC_CONFLICT');
        if (byName.estatus === 'BLOQUEADO') this.fail('CLIENT_STATUS_NOT_MANAGEABLE');
        if (byName.estatus !== 'ACTIVO') await client.query("UPDATE core.empresas SET estatus = 'ACTIVO' WHERE empresa_id = $1", [byName.empresa_id]);
        await this.activateRole(client, byName.empresa_id);
        if (input.fiscal && !fiscal) {
          await client.query(`INSERT INTO core.empresas_fiscales (empresa_id, razon_social, rfc, es_vigente)
            VALUES ($1, $2, $3, TRUE)`, [byName.empresa_id, input.fiscal.legalName, input.fiscal.rfc]);
        }
        return (await this.findById(client, byName.empresa_id))!;
      }

      const companyResult = await client.query<CompanyRow>(`INSERT INTO core.empresas (tipo_empresa, nombre_comercial, observaciones)
        VALUES ('CLIENTE', $1, $2) RETURNING empresa_id::text, tipo_empresa, nombre_comercial, estatus, observaciones`, [input.commercialName, input.notes ?? null]);
      const company = companyResult.rows[0]!;
      await client.query("INSERT INTO core.empresa_roles (empresa_id, rol, estatus) VALUES ($1, 'CLIENTE', 'ACTIVO')", [company.empresa_id]);
      if (input.fiscal) await client.query(`INSERT INTO core.empresas_fiscales (empresa_id, razon_social, rfc, es_vigente)
        VALUES ($1, $2, $3, TRUE)`, [company.empresa_id, input.fiscal.legalName, input.fiscal.rfc]);
      return (await this.findById(client, company.empresa_id))!;
    });
  }

  async update(id: string, input: UpdateClientDto, requestId: string, identity: AuditIdentity): Promise<ClientRow | null> {
    return this.transaction(requestId, identity, async (client) => {
      const company = await this.lockCompany(client, id);
      if (!company || company.estatus !== 'ACTIVO') return null;
      const roles = await this.lockRoles(client, id);
      if (!roles.some((role) => role.rol === 'CLIENTE' && role.estatus === 'ACTIVO')) return null;
      const fiscal = await this.lockCurrentFiscal(client, id);
      if (input.commercialName !== undefined || input.notes !== undefined) {
        const values: unknown[] = [];
        const sets: string[] = [];
        if (input.commercialName !== undefined) { values.push(input.commercialName); sets.push(`nombre_comercial = $${values.length}`); }
        if (input.notes !== undefined) { values.push(input.notes); sets.push(`observaciones = $${values.length}`); }
        values.push(id);
        await client.query(`UPDATE core.empresas SET ${sets.join(', ')} WHERE empresa_id = $${values.length}`, values);
      }
      await this.updateFiscal(client, id, fiscal, input);
      return this.findById(client, id);
    });
  }

  async changeStatus(id: string, target: 'ACTIVO' | 'INACTIVO', requestId: string, identity: AuditIdentity): Promise<ClientRow | null> {
    return this.transaction(requestId, identity, async (client) => {
      const company = await this.lockCompany(client, id);
      if (!company) return null;
      const roles = await this.lockRoles(client, id);
      const clientRole = roles.find((role) => role.rol === 'CLIENTE');
      if (company.estatus === 'BLOQUEADO') this.fail('CLIENT_STATUS_NOT_MANAGEABLE');
      if (target === 'INACTIVO') {
        if (!clientRole) return null;
        if (clientRole.estatus !== 'ACTIVO') this.fail('CLIENT_ALREADY_INACTIVE');
        await client.query("UPDATE core.empresa_roles SET estatus = 'INACTIVO' WHERE empresa_id = $1 AND rol = 'CLIENTE'", [id]);
        if (!roles.some((role) => role.rol !== 'CLIENTE' && role.estatus === 'ACTIVO')) {
          await client.query("UPDATE core.empresas SET estatus = 'INACTIVO' WHERE empresa_id = $1", [id]);
        }
      } else {
        if (!clientRole) return null;
        if (clientRole?.estatus === 'ACTIVO' && company.estatus === 'ACTIVO') this.fail('CLIENT_ALREADY_ACTIVE');
        if (company.estatus !== 'ACTIVO') await client.query("UPDATE core.empresas SET estatus = 'ACTIVO' WHERE empresa_id = $1", [id]);
        await this.activateRole(client, id);
      }
      return this.findById(client, id);
    });
  }

  private async findById(client: PoolClient, id: string): Promise<ClientRow | null> {
    const result = await client.query<ClientRow>(`SELECT ${clientSelect} FROM core.empresas company ${clientJoins}
      WHERE company.empresa_id = $1`, [id]);
    return result.rows[0] ?? null;
  }

  private async lockCompany(client: PoolClient, id: string): Promise<CompanyRow | null> {
    const result = await client.query<CompanyRow>(`SELECT empresa_id::text, tipo_empresa, nombre_comercial, estatus, observaciones
      FROM core.empresas WHERE empresa_id = $1 FOR UPDATE`, [id]);
    return result.rows[0] ?? null;
  }

  private async lockCompanyByName(client: PoolClient, name: string): Promise<CompanyRow | null> {
    const result = await client.query<CompanyRow>(`SELECT empresa_id::text, tipo_empresa, nombre_comercial, estatus, observaciones
      FROM core.empresas WHERE lower(btrim(nombre_comercial)) = lower(btrim($1)) FOR UPDATE`, [name]);
    return result.rows[0] ?? null;
  }

  private async lockCompanyByRfc(client: PoolClient, rfc: string): Promise<CompanyRow | null> {
    const result = await client.query<CompanyRow>(`SELECT company.empresa_id::text, company.tipo_empresa, company.nombre_comercial, company.estatus, company.observaciones
      FROM core.empresas company JOIN core.empresas_fiscales fiscal ON fiscal.empresa_id = company.empresa_id
      WHERE upper(btrim(fiscal.rfc)) = upper(btrim($1)) ORDER BY fiscal.es_vigente DESC, fiscal.empresa_fiscal_id DESC
      LIMIT 1 FOR UPDATE OF company`, [rfc]);
    return result.rows[0] ?? null;
  }

  private async lockRoles(client: PoolClient, id: string): Promise<RoleRow[]> {
    const result = await client.query<RoleRow>('SELECT rol, estatus FROM core.empresa_roles WHERE empresa_id = $1 FOR UPDATE', [id]);
    return result.rows;
  }

  private async lockCurrentFiscal(client: PoolClient, id: string): Promise<FiscalRow | null> {
    const result = await client.query<FiscalRow>(`SELECT empresa_fiscal_id::text, razon_social, rfc, fecha_inicio::text, fecha_fin::text
      FROM core.empresas_fiscales WHERE empresa_id = $1 AND es_vigente = TRUE
      ORDER BY fecha_inicio DESC NULLS LAST, empresa_fiscal_id DESC LIMIT 1 FOR UPDATE`, [id]);
    return result.rows[0] ?? null;
  }

  private async activateRole(client: PoolClient, id: string): Promise<void> {
    await client.query(`INSERT INTO core.empresa_roles (empresa_id, rol, estatus) VALUES ($1, 'CLIENTE', 'ACTIVO')
      ON CONFLICT (empresa_id, rol) DO UPDATE SET estatus = 'ACTIVO'`, [id]);
  }

  private async updateFiscal(client: PoolClient, id: string, current: FiscalRow | null, input: UpdateClientDto): Promise<void> {
    const fiscal = input.fiscal;
    if (!fiscal) return;
    const legalName = fiscal.legalName?.trim() ?? '';
    const rfc = fiscal.rfc?.trim() ?? '';
    // Defence in depth: the service already enforces this pairing (Providers-compatible contract).
    // Refuse a half-pair here too rather than silently coercing the missing side to ''.
    if (Boolean(legalName) !== Boolean(rfc)) this.fail('FISCAL_INCOMPLETE');
    if (!current) {
      if (!legalName && !rfc) return;
      await client.query('INSERT INTO core.empresas_fiscales (empresa_id, razon_social, rfc, es_vigente) VALUES ($1, $2, $3, TRUE)', [id, legalName, rfc]);
      return;
    }
    if (!legalName && !rfc) this.fail('FISCAL_REMOVAL_NOT_ALLOWED');
    if (this.normalizeRfc(rfc) === this.normalizeRfc(current.rfc)) {
      if (legalName !== current.razon_social) await client.query('UPDATE core.empresas_fiscales SET razon_social = $1 WHERE empresa_fiscal_id = $2', [legalName, current.empresa_fiscal_id]);
      return;
    }
    if (!fiscal.changeMode) this.fail('FISCAL_CHANGE_MODE_REQUIRED');
    if (fiscal.changeMode === FiscalChangeMode.Correction) {
      await client.query('UPDATE core.empresas_fiscales SET razon_social = $1, rfc = $2 WHERE empresa_fiscal_id = $3', [legalName, rfc, current.empresa_fiscal_id]);
      return;
    }
    await client.query('UPDATE core.empresas_fiscales SET es_vigente = FALSE, fecha_fin = $1 WHERE empresa_fiscal_id = $2', [fiscal.effectiveStartDate, current.empresa_fiscal_id]);
    await client.query('INSERT INTO core.empresas_fiscales (empresa_id, razon_social, rfc, es_vigente, fecha_inicio) VALUES ($1, $2, $3, TRUE, $4)', [id, legalName, rfc, fiscal.effectiveStartDate]);
  }

  private normalizeRfc(value: string): string {
    return value.trim().toUpperCase();
  }

  private async transaction<T>(requestId: string, identity: AuditIdentity, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']);
      await client.query("SELECT set_config('app.request_id', $1, true)", [requestId]);
      await client.query("SELECT set_config('app.user_id', COALESCE($1, ''), true)", [identity.userId]);
      await client.query("SELECT set_config('app.user_email', COALESCE($1, ''), true)", [identity.userEmail]);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the original database error. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  private fail(code: string): never {
    throw Object.assign(new Error(code), { code });
  }
}
