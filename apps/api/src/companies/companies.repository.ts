import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';

export interface CompanySearchRow extends QueryResultRow {
  id: string;
  commercial_name: string;
  company_type: string;
  legal_name: string | null;
  rfc: string | null;
  matched_alias: string | null;
}

@Injectable()
export class CompaniesRepository {
  constructor(private readonly database: DatabaseService) {}

  search(search: string | undefined): Promise<CompanySearchRow[]> {
    return this.database.query<CompanySearchRow>(`
      SELECT
        company.empresa_id::text AS id,
        company.nombre_comercial AS commercial_name,
        company.tipo_empresa AS company_type,
        fiscal.razon_social AS legal_name,
        fiscal.rfc,
        CASE WHEN $1::text IS NULL OR lower(btrim(company.nombre_comercial)) LIKE '%' || lower($1) || '%' THEN NULL ELSE (
          SELECT alias.alias
          FROM core.alias_empresa alias
          WHERE alias.empresa_id = company.empresa_id
            AND alias.estatus = 'ACTIVO'
            AND lower(btrim(alias.alias_normalizado)) LIKE '%' || lower($1) || '%'
          ORDER BY
            CASE WHEN lower(btrim(alias.alias_normalizado)) = lower($1) THEN 0 ELSE 1 END,
            CASE WHEN lower(btrim(alias.alias_normalizado)) LIKE lower($1) || '%' THEN 0 ELSE 1 END,
            length(btrim(alias.alias_normalizado)),
            lower(btrim(alias.alias_normalizado)),
            alias.alias
          LIMIT 1
        ) END AS matched_alias
      FROM core.empresas company
      LEFT JOIN LATERAL (
        SELECT razon_social, rfc
        FROM core.empresas_fiscales
        WHERE empresa_id = company.empresa_id AND es_vigente = TRUE
        ORDER BY fecha_inicio DESC NULLS LAST, empresa_fiscal_id DESC
        LIMIT 1
      ) fiscal ON TRUE
      WHERE company.estatus = 'ACTIVO'
        AND ($1::text IS NULL
          OR lower(btrim(company.nombre_comercial)) LIKE '%' || lower($1) || '%'
          OR lower(btrim(fiscal.razon_social)) LIKE '%' || lower($1) || '%'
          OR lower(btrim(fiscal.rfc)) LIKE '%' || lower($1) || '%'
          OR EXISTS (
            SELECT 1 FROM core.alias_empresa alias
            WHERE alias.empresa_id = company.empresa_id
              AND alias.estatus = 'ACTIVO'
              AND lower(btrim(alias.alias_normalizado)) LIKE '%' || lower($1) || '%'
          ))
      ORDER BY lower(btrim(company.nombre_comercial)), company.empresa_id
      LIMIT 20`, [search ?? null]);
  }
}
