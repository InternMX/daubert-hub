import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { replaceCompanyAliases } from '../companies/company-aliases.repository';
import { DatabaseService } from '../database/database.service';
import { normalizePaymentAlias } from './payment-alias';

export interface AuditIdentity {
  userId: string | null;
  userEmail: string | null;
}

export interface CompanyAliases {
  aliases: string[];
  otherAliases: Array<{ alias: string; type: string }>;
}

interface CompanyAliasRow extends QueryResultRow {
  alias: string;
  tipo_alias: string;
}

const aliasesQuery = `SELECT alias, tipo_alias FROM core.alias_empresa
  WHERE empresa_id = $1 AND estatus = 'ACTIVO'
  ORDER BY tipo_alias, lower(btrim(alias)), alias_id`;

function group(rows: CompanyAliasRow[]): CompanyAliases {
  return {
    aliases: rows.filter((row) => row.tipo_alias === 'NOMBRE_COMERCIAL_ALTERNATIVO').map((row) => row.alias),
    otherAliases: rows.filter((row) => row.tipo_alias !== 'NOMBRE_COMERCIAL_ALTERNATIVO').map((row) => ({ alias: row.alias, type: row.tipo_alias }))
  };
}

@Injectable()
export class AliasesRepository {
  constructor(private readonly database: DatabaseService) {}

  async createPaymentAlias(companyId: string, alias: string, normalizedAlias: string, requestId: string, identity: AuditIdentity) {
    return this.transaction(requestId, identity, async (client) => {
      // Serialize with all catalog writers, including the existing replace CRUD.
      // Name changes must not race the ambiguity check either.
      await client.query('LOCK TABLE core.empresas IN SHARE ROW EXCLUSIVE MODE');
      await client.query('LOCK TABLE core.alias_empresa IN SHARE ROW EXCLUSIVE MODE');
      const company = (await client.query<{ name: string }>('SELECT nombre_comercial AS name FROM core.empresas WHERE empresa_id = $1', [companyId])).rows[0];
      if (!company) return null;
      const candidates = await client.query<{ company_id: string; alias: string; stored_alias: boolean }>(`
        SELECT empresa_id::text AS company_id, alias, TRUE AS stored_alias
        FROM core.alias_empresa WHERE estatus = 'ACTIVO'
        UNION ALL
        SELECT empresa_id::text, nombre_comercial, FALSE FROM core.empresas`);
      const matches = candidates.rows.filter((row) => normalizePaymentAlias(row.alias) === normalizedAlias);
      if (matches.some((row) => row.company_id !== companyId)) {
        throw Object.assign(new Error('ALIAS_ALREADY_ASSOCIATED'), { code: 'ALIAS_ALREADY_ASSOCIATED' });
      }
      const alreadyAssigned = matches.some((row) => row.stored_alias);
      if (!alreadyAssigned) {
        await client.query(`INSERT INTO core.alias_empresa (empresa_id, alias, alias_normalizado, tipo_alias, estatus)
          VALUES ($1, $2, $3, 'NOMBRE_ARCHIVO', 'ACTIVO')`, [companyId, alias, normalizedAlias]);
      }
      return { companyId, companyName: company.name, alias, normalizedAlias, alreadyAssigned };
    });
  }

  async list(companyId: string): Promise<CompanyAliases | null> {
    const company = await this.database.query<{ exists: boolean }>('SELECT TRUE AS exists FROM core.empresas WHERE empresa_id = $1', [companyId]);
    if (!company[0]) return null;
    const rows = await this.database.query<CompanyAliasRow>(aliasesQuery, [companyId]);
    return group(rows);
  }

  async replace(companyId: string, aliases: string[], requestId: string, identity: AuditIdentity): Promise<CompanyAliases | null> {
    return this.transaction(requestId, identity, async (client) => {
      const company = await client.query<{ empresa_id: string }>('SELECT empresa_id::text FROM core.empresas WHERE empresa_id = $1 FOR UPDATE', [companyId]);
      if (!company.rows[0]) return null;
      await replaceCompanyAliases(client, companyId, aliases);
      const rows = await client.query<CompanyAliasRow>(aliasesQuery, [companyId]);
      return group(rows.rows);
    });
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
}
