import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import type { ListContactDirectoryCompaniesDto } from './dto/list-contact-directory-companies.dto';

interface CompanyRow extends QueryResultRow { id: string; commercial_name: string; company_type: string; contact_count: string; matched_alias: string | null; }
interface ContactRow extends QueryResultRow { id: string; name: string | null; contact_type: string; area: string | null; position: string | null; is_primary: boolean; }
interface MethodRow extends QueryResultRow { id: string; contact_id: string; type: string; value: string; is_primary: boolean; }
export interface CompanyDetailRecord { company: Omit<CompanyRow, 'contact_count'>; contacts: Array<ContactRow & { methods: MethodRow[]; inactiveMethods: MethodRow[] }>; }

@Injectable()
export class ContactDirectoryRepository {
  constructor(private readonly database: DatabaseService) {}

  async list(input: ListContactDirectoryCompaniesDto): Promise<{ total: number; companies: CompanyRow[] }> {
    const filter = `FROM core.empresas company
      WHERE company.estatus = 'ACTIVO'
        AND ($1::text IS NULL OR lower(btrim(company.nombre_comercial)) LIKE '%' || lower($1) || '%'
          OR EXISTS (SELECT 1 FROM core.alias_empresa alias WHERE alias.empresa_id = company.empresa_id AND alias.estatus = 'ACTIVO' AND lower(btrim(alias.alias_normalizado)) LIKE '%' || lower($1) || '%')
          OR EXISTS (SELECT 1 FROM core.contactos contact WHERE contact.empresa_id = company.empresa_id AND contact.estatus = 'ACTIVO' AND (lower(coalesce(contact.nombre, '')) LIKE '%' || lower($1) || '%' OR lower(coalesce(contact.area, '')) LIKE '%' || lower($1) || '%' OR lower(coalesce(contact.cargo, '')) LIKE '%' || lower($1) || '%' OR EXISTS (SELECT 1 FROM core.medios_contacto method WHERE method.contacto_id = contact.contacto_id AND method.estatus = 'ACTIVO' AND lower(btrim(method.valor)) LIKE '%' || lower($1) || '%'))))`;
    const values = [input.search ?? null];
    const [count] = await this.database.query<{ total: string }>(`SELECT count(*)::int AS total ${filter}`, values);
    const companies = await this.database.query<CompanyRow>(`SELECT company.empresa_id::text AS id, company.nombre_comercial AS commercial_name, company.tipo_empresa AS company_type,
      (SELECT count(*)::int FROM core.contactos contact WHERE contact.empresa_id = company.empresa_id AND contact.estatus = 'ACTIVO')::text AS contact_count,
      CASE WHEN $1::text IS NULL OR lower(btrim(company.nombre_comercial)) LIKE '%' || lower($1) || '%' THEN NULL ELSE (
        SELECT alias.alias FROM core.alias_empresa alias
        WHERE alias.empresa_id = company.empresa_id AND alias.estatus = 'ACTIVO' AND lower(btrim(alias.alias_normalizado)) LIKE '%' || lower($1) || '%'
        ORDER BY CASE WHEN lower(btrim(alias.alias_normalizado)) = lower($1) THEN 0 ELSE 1 END,
          CASE WHEN lower(btrim(alias.alias_normalizado)) LIKE lower($1) || '%' THEN 0 ELSE 1 END,
          length(btrim(alias.alias_normalizado)), lower(btrim(alias.alias_normalizado)), alias.alias
        LIMIT 1
      ) END AS matched_alias
      ${filter} ORDER BY lower(btrim(company.nombre_comercial)), company.empresa_id LIMIT $2 OFFSET $3`, [...values, input.pageSize, (input.page - 1) * input.pageSize]);
    return { total: Number(count?.total ?? 0), companies };
  }

  async findById(id: number): Promise<CompanyDetailRecord | null> {
    const [company] = await this.database.query<Omit<CompanyRow, 'contact_count' | 'matched_alias'>>(`SELECT empresa_id::text AS id, nombre_comercial AS commercial_name, tipo_empresa AS company_type FROM core.empresas WHERE empresa_id = $1 AND estatus = 'ACTIVO'`, [id]);
    if (!company) return null;
    const contacts = await this.database.query<ContactRow>(`SELECT contacto_id::text AS id, nombre AS name, tipo_contacto AS contact_type, area, cargo AS position, es_contacto_principal AS is_primary
      FROM core.contactos WHERE empresa_id = $1 AND estatus = 'ACTIVO'
      ORDER BY es_contacto_principal DESC, CASE WHEN tipo_contacto = 'PERSONA' AND nombre IS NOT NULL THEN 0 WHEN tipo_contacto = 'BUZON_GENERICO' THEN 1 WHEN tipo_contacto = 'AREA' THEN 2 ELSE 3 END, lower(coalesce(area, nombre, '')), contacto_id`, [id]);
    const methods = contacts.length ? await this.database.query<MethodRow>(`SELECT medio_id::text AS id, contacto_id::text AS contact_id, tipo_medio AS type, valor AS value, es_principal AS is_primary FROM core.medios_contacto WHERE contacto_id = ANY($1::bigint[]) AND estatus = 'ACTIVO'
      ORDER BY contacto_id, es_principal DESC, CASE tipo_medio WHEN 'CORREO' THEN 1 WHEN 'TELEFONO' THEN 2 WHEN 'WHATSAPP' THEN 3 WHEN 'OTRO' THEN 4 ELSE 5 END, lower(btrim(valor)), medio_id`, [contacts.map((contact) => contact.id)]) : [];
    const inactiveMethods = contacts.length ? await this.database.query<MethodRow>(`SELECT medio_id::text AS id, contacto_id::text AS contact_id, tipo_medio AS type, valor AS value, es_principal AS is_primary FROM core.medios_contacto WHERE contacto_id = ANY($1::bigint[]) AND estatus = 'INACTIVO'
      ORDER BY contacto_id, es_principal DESC, CASE tipo_medio WHEN 'CORREO' THEN 1 WHEN 'TELEFONO' THEN 2 WHEN 'WHATSAPP' THEN 3 WHEN 'OTRO' THEN 4 ELSE 5 END, lower(btrim(valor)), medio_id`, [contacts.map((contact) => contact.id)]) : [];
    const byContact = new Map<string, MethodRow[]>();
    const inactiveByContact = new Map<string, MethodRow[]>();
    methods.forEach((method) => byContact.set(method.contact_id, [...(byContact.get(method.contact_id) ?? []), method]));
    inactiveMethods.forEach((method) => inactiveByContact.set(method.contact_id, [...(inactiveByContact.get(method.contact_id) ?? []), method]));
    return { company, contacts: contacts.map((contact) => ({ ...contact, methods: byContact.get(contact.id) ?? [], inactiveMethods: inactiveByContact.get(contact.id) ?? [] })) };
  }
}
