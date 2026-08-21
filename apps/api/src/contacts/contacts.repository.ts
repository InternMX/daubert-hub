import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import { ContactType, type CreateContactDto, type CreateContactMethodDto } from './dto/create-contact.dto';

interface CompanyRow extends QueryResultRow {
  empresa_id: string;
  estatus: string;
}

interface ContactRow extends QueryResultRow {
  contacto_id: string;
  empresa_id: string;
  tipo_contacto: string;
  nombre: string | null;
  area: string | null;
  cargo: string | null;
  observaciones: string | null;
  estatus: string;
  es_contacto_principal: boolean;
}

interface MethodRow extends QueryResultRow {
  medio_id: string;
  contacto_id: string;
  tipo_medio: string;
  valor: string;
  estatus: string;
  es_principal: boolean;
}

export interface CreatedContactRecord {
  contact: ContactRow;
  methods: MethodRow[];
}

@Injectable()
export class ContactsRepository {
  constructor(private readonly database: DatabaseService) {}

  async create(input: CreateContactDto, requestId: string): Promise<CreatedContactRecord> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await this.setAuditContext(client, requestId);
      await this.assertActiveCompany(client, input.companyId);
      const contact = await this.insertContact(client, input);
      const methods: MethodRow[] = [];
      for (const method of input.methods) methods.push(await this.insertMethod(client, contact.contacto_id, method));
      await client.query('COMMIT');
      return { contact, methods };
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

  private async setAuditContext(client: PoolClient, requestId: string): Promise<void> {
    await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']);
    await client.query("SELECT set_config('app.request_id', $1, true)", [requestId]);
  }

  private async assertActiveCompany(client: PoolClient, companyId: string): Promise<void> {
    const result = await client.query<CompanyRow>('SELECT empresa_id::text, estatus FROM core.empresas WHERE empresa_id = $1 FOR UPDATE', [companyId]);
    const company = result.rows[0];
    if (!company) throw Object.assign(new Error('COMPANY_NOT_FOUND'), { code: 'COMPANY_NOT_FOUND' });
    if (company.estatus === 'INACTIVO') throw Object.assign(new Error('COMPANY_INACTIVE'), { code: 'COMPANY_INACTIVE' });
    if (company.estatus === 'BLOQUEADO') throw Object.assign(new Error('COMPANY_BLOCKED'), { code: 'COMPANY_BLOCKED' });
    if (company.estatus !== 'ACTIVO') throw Object.assign(new Error('COMPANY_NOT_ACTIVE'), { code: 'COMPANY_NOT_ACTIVE' });
  }

  private async insertContact(client: PoolClient, input: CreateContactDto): Promise<ContactRow> {
    const result = await client.query<ContactRow>(`
      INSERT INTO core.contactos
        (empresa_id, tipo_contacto, nombre, area, cargo, observaciones, estatus, es_contacto_principal)
      VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVO', FALSE)
      RETURNING contacto_id::text, empresa_id::text, tipo_contacto, nombre, area, cargo, observaciones, estatus, es_contacto_principal`, [
      input.companyId,
      input.contactType,
      input.contactType === ContactType.Person ? input.name ?? null : null,
      input.area ?? null,
      input.contactType === ContactType.Person ? input.position ?? null : null,
      input.notes ?? null
    ]);
    return result.rows[0]!;
  }

  private async insertMethod(client: PoolClient, contactId: string, method: CreateContactMethodDto): Promise<MethodRow> {
    const result = await client.query<MethodRow>(`
      INSERT INTO core.medios_contacto
        (contacto_id, tipo_medio, valor, estatus, es_principal, recibe_notificacion_pago, tipo_destinatario_pago)
      VALUES ($1, $2, $3, 'ACTIVO', FALSE, FALSE, NULL)
      RETURNING medio_id::text, contacto_id::text, tipo_medio, valor, estatus, es_principal`, [contactId, method.type, method.value]);
    return result.rows[0]!;
  }
}
