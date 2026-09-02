import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import type { CreateAddressDto } from './dto/create-address.dto';
import type { UpdateAddressDto } from './dto/update-address.dto';

export interface AuditIdentity {
  userId: string | null;
  userEmail: string | null;
}

export interface AddressRow extends QueryResultRow {
  direccion_id: string;
  empresa_id: string;
  tipo_direccion: string;
  calle: string | null;
  numero_exterior: string | null;
  numero_interior: string | null;
  colonia: string | null;
  municipio: string | null;
  estado: string | null;
  codigo_postal: string | null;
  pais: string | null;
  referencias: string | null;
  direccion_completa: string | null;
  estatus: string;
  es_principal: boolean;
  fecha_inicio: string | null;
  fecha_fin: string | null;
}

type LockedAddress = AddressRow & { company_status: string };

const addressColumns = `direccion.direccion_id::text, direccion.empresa_id::text, direccion.tipo_direccion,
  direccion.calle, direccion.numero_exterior, direccion.numero_interior, direccion.colonia,
  direccion.municipio, direccion.estado, direccion.codigo_postal, direccion.pais, direccion.referencias,
  direccion.direccion_completa, direccion.estatus, direccion.es_principal,
  direccion.fecha_inicio::text, direccion.fecha_fin::text`;

const fieldColumns: Record<keyof CreateAddressDto, string> = {
  tipoDireccion: 'tipo_direccion', calle: 'calle', numeroExterior: 'numero_exterior', numeroInterior: 'numero_interior',
  colonia: 'colonia', municipio: 'municipio', estado: 'estado', codigoPostal: 'codigo_postal', pais: 'pais',
  referencias: 'referencias', direccionCompleta: 'direccion_completa', esPrincipal: 'es_principal',
  fechaInicio: 'fecha_inicio', fechaFin: 'fecha_fin'
};

@Injectable()
export class AddressesRepository {
  constructor(private readonly database: DatabaseService) {}

  async list(companyId: string): Promise<AddressRow[] | null> {
    const company = await this.database.query<{ exists: boolean }>('SELECT TRUE AS exists FROM core.empresas WHERE empresa_id = $1', [companyId]);
    if (!company[0]) return null;
    return this.database.query<AddressRow>(`SELECT ${addressColumns}
      FROM core.direcciones direccion
      WHERE direccion.empresa_id = $1 AND direccion.empresa_fiscal_id IS NULL
      ORDER BY (direccion.estatus = 'ACTIVA') DESC, direccion.es_principal DESC,
        direccion.tipo_direccion, direccion.fecha_inicio DESC NULLS LAST,
        lower(coalesce(direccion.direccion_completa, direccion.calle, '')), direccion.direccion_id`, [companyId]);
  }

  async create(companyId: string, input: CreateAddressDto, requestId: string, identity: AuditIdentity): Promise<AddressRow> {
    return this.transaction(requestId, identity, async (client) => {
      await this.assertActiveCompany(client, companyId);
      this.assertContentAndDates(input.calle ?? null, input.direccionCompleta ?? null, input.fechaInicio ?? null, input.fechaFin ?? null);
      if (input.esPrincipal) await this.demotePrincipals(client, companyId, input.tipoDireccion);
      const entries = Object.entries(fieldColumns).filter(([field]) => input[field as keyof CreateAddressDto] !== undefined);
      const columns = ['empresa_id', ...entries.map(([, column]) => column)];
      const values: unknown[] = [companyId, ...entries.map(([field]) => input[field as keyof CreateAddressDto])];
      const result = await client.query<AddressRow>(`INSERT INTO core.direcciones (${columns.join(', ')})
        VALUES (${values.map((_, index) => `$${index + 1}`).join(', ')})
        RETURNING direccion_id::text, empresa_id::text, tipo_direccion, calle, numero_exterior, numero_interior,
          colonia, municipio, estado, codigo_postal, pais, referencias, direccion_completa, estatus, es_principal,
          fecha_inicio::text, fecha_fin::text`, values);
      return result.rows[0]!;
    });
  }

  async update(id: string, input: UpdateAddressDto, requestId: string, identity: AuditIdentity): Promise<AddressRow | null> {
    return this.transaction(requestId, identity, async (client) => {
      const companyId = await this.findGenericOwner(client, id);
      if (!companyId) return null;
      await this.assertActiveCompany(client, companyId);
      const current = await this.lockGenericAddress(client, id);
      if (!current) return null;
      if (current.estatus !== 'ACTIVA') this.fail('ADDRESS_NOT_ACTIVE');
      const entries = Object.entries(fieldColumns).filter(([field]) => input[field as keyof UpdateAddressDto] !== undefined);
      const resultingType = input.tipoDireccion ?? current.tipo_direccion;
      const resultingPrimary = input.esPrincipal ?? current.es_principal;
      this.assertContentAndDates(
        input.calle === undefined ? current.calle : input.calle,
        input.direccionCompleta === undefined ? current.direccion_completa : input.direccionCompleta,
        input.fechaInicio === undefined ? current.fecha_inicio : input.fechaInicio,
        input.fechaFin === undefined ? current.fecha_fin : input.fechaFin
      );
      if (resultingPrimary) await this.demotePrincipals(client, companyId, resultingType, id);
      const values: unknown[] = entries.map(([field]) => input[field as keyof UpdateAddressDto]);
      values.push(id);
      const result = await client.query<AddressRow>(`UPDATE core.direcciones direccion
        SET ${entries.map(([, column], index) => `${column} = $${index + 1}`).join(', ')}
        WHERE direccion.direccion_id = $${values.length} AND direccion.empresa_id = $${values.length + 1}
          AND direccion.empresa_fiscal_id IS NULL
        RETURNING direccion_id::text, empresa_id::text, tipo_direccion, calle, numero_exterior, numero_interior,
          colonia, municipio, estado, codigo_postal, pais, referencias, direccion_completa, estatus, es_principal,
          fecha_inicio::text, fecha_fin::text`, [...values, companyId]);
      return result.rows[0] ?? null;
    });
  }

  async changeStatus(id: string, target: 'ACTIVA' | 'INACTIVA', requestId: string, identity: AuditIdentity): Promise<AddressRow | null> {
    return this.transaction(requestId, identity, async (client) => {
      const companyId = await this.findGenericOwner(client, id);
      if (!companyId) return null;
      await this.assertActiveCompany(client, companyId);
      const current = await this.lockGenericAddress(client, id);
      if (!current) return null;
      if (!['ACTIVA', 'INACTIVA'].includes(current.estatus)) this.fail('ADDRESS_STATUS_NOT_MANAGEABLE');
      if (current.estatus === target) this.fail(target === 'ACTIVA' ? 'ADDRESS_ALREADY_ACTIVE' : 'ADDRESS_ALREADY_INACTIVE');
      if (target === 'ACTIVA' && current.es_principal) await this.demotePrincipals(client, companyId, current.tipo_direccion, id);
      const result = await client.query<AddressRow>(`UPDATE core.direcciones direccion SET estatus = $1
        WHERE direccion.direccion_id = $2 AND direccion.empresa_id = $3 AND direccion.empresa_fiscal_id IS NULL
        RETURNING direccion_id::text, empresa_id::text, tipo_direccion, calle, numero_exterior, numero_interior,
          colonia, municipio, estado, codigo_postal, pais, referencias, direccion_completa, estatus, es_principal,
          fecha_inicio::text, fecha_fin::text`, [target, id, companyId]);
      return result.rows[0] ?? null;
    });
  }

  private async findGenericOwner(client: PoolClient, id: string): Promise<string | null> {
    const result = await client.query<{ empresa_id: string }>('SELECT empresa_id::text FROM core.direcciones WHERE direccion_id = $1 AND empresa_id IS NOT NULL AND empresa_fiscal_id IS NULL', [id]);
    return result.rows[0]?.empresa_id ?? null;
  }

  private async assertActiveCompany(client: PoolClient, companyId: string): Promise<void> {
    const result = await client.query<{ estatus: string }>('SELECT estatus FROM core.empresas WHERE empresa_id = $1 FOR UPDATE', [companyId]);
    const company = result.rows[0];
    if (!company) this.fail('COMPANY_NOT_FOUND');
    if (company.estatus !== 'ACTIVO') this.fail('COMPANY_NOT_ACTIVE');
  }

  private async lockGenericAddress(client: PoolClient, id: string): Promise<LockedAddress | null> {
    const result = await client.query<LockedAddress>(`SELECT ${addressColumns}, company.estatus AS company_status
      FROM core.direcciones direccion JOIN core.empresas company ON company.empresa_id = direccion.empresa_id
      WHERE direccion.direccion_id = $1 AND direccion.empresa_fiscal_id IS NULL FOR UPDATE OF direccion`, [id]);
    return result.rows[0] ?? null;
  }

  private async demotePrincipals(client: PoolClient, companyId: string, type: string, excludeId?: string): Promise<void> {
    await client.query(`UPDATE core.direcciones SET es_principal = FALSE
      WHERE empresa_id = $1 AND empresa_fiscal_id IS NULL AND tipo_direccion = $2
        AND estatus = 'ACTIVA' AND es_principal = TRUE AND ($3::bigint IS NULL OR direccion_id <> $3)`, [companyId, type, excludeId ?? null]);
  }

  private assertContentAndDates(calle: string | null, completa: string | null, inicio: string | null, fin: string | null): void {
    if (!calle && !completa) this.fail('ADDRESS_CONTENT_REQUIRED');
    if (inicio && fin && inicio > fin) this.fail('ADDRESS_DATE_ORDER');
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
      try { await client.query('ROLLBACK'); } catch { /* Preserve the original error. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  private fail(code: string): never {
    throw Object.assign(new Error(code), { code });
  }
}
