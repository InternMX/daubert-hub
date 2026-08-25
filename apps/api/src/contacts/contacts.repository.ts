import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import { ContactType, type CreateContactDto, type CreateContactMethodDto } from './dto/create-contact.dto';
import type { UpdateContactDto } from './dto/update-contact.dto';

interface CompanyRow extends QueryResultRow {
  empresa_id: string;
  estatus: string;
}

export interface ContactRow extends QueryResultRow {
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

  async update(id: string, input: UpdateContactDto, requestId: string): Promise<ContactRow | null> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await this.setAuditContext(client, requestId);
      const contact = await this.lockContact(client, id);
      if (!contact) { await client.query('COMMIT'); return null; }
      if (contact.company_status !== 'ACTIVO') throw Object.assign(new Error('COMPANY_NOT_ACTIVE'), { code: 'COMPANY_NOT_ACTIVE' });
      if (contact.estatus !== 'ACTIVO') throw Object.assign(new Error('CONTACT_NOT_ACTIVE'), { code: 'CONTACT_NOT_ACTIVE' });
      const changes = this.contactChanges(contact, input);
      if (changes.length === 0) throw Object.assign(new Error('CONTACT_NO_CHANGES'), { code: 'CONTACT_NO_CHANGES' });
      const values = changes.map((change) => change.value);
      values.push(id);
      const result = await client.query<ContactRow>(`
        UPDATE core.contactos SET ${changes.map((change, index) => `${change.column} = $${index + 1}`).join(', ')}
        WHERE contacto_id = $${values.length}
        RETURNING contacto_id::text, empresa_id::text, tipo_contacto, nombre, area, cargo, observaciones, estatus, es_contacto_principal`, values);
      await client.query('COMMIT');
      return result.rows[0]!;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the original database error. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async changeStatus(id: string, targetStatus: 'ACTIVO' | 'INACTIVO', requestId: string): Promise<ContactRow | null> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await this.setAuditContext(client, requestId);
      const contact = await this.lockContact(client, id);
      if (!contact) { await client.query('COMMIT'); return null; }
      if (contact.company_status === 'INACTIVO') throw Object.assign(new Error('COMPANY_INACTIVE'), { code: 'COMPANY_INACTIVE' });
      if (contact.company_status === 'BLOQUEADO') throw Object.assign(new Error('COMPANY_BLOCKED'), { code: 'COMPANY_BLOCKED' });
      if (contact.company_status !== 'ACTIVO') throw Object.assign(new Error('COMPANY_NOT_ACTIVE'), { code: 'COMPANY_NOT_ACTIVE' });
      if (contact.estatus !== 'ACTIVO' && contact.estatus !== 'INACTIVO') {
        throw Object.assign(new Error('CONTACT_STATUS_NOT_MANAGEABLE'), { code: 'CONTACT_STATUS_NOT_MANAGEABLE' });
      }
      if (contact.estatus === targetStatus) {
        const code = targetStatus === 'ACTIVO' ? 'CONTACT_ALREADY_ACTIVE' : 'CONTACT_ALREADY_INACTIVE';
        throw Object.assign(new Error(code), { code });
      }
      const result = await client.query<ContactRow>(`
        UPDATE core.contactos SET estatus = $1
        WHERE contacto_id = $2
        RETURNING contacto_id::text, empresa_id::text, tipo_contacto, nombre, area, cargo, observaciones, estatus, es_contacto_principal`, [targetStatus, id]);
      await client.query('COMMIT');
      return result.rows[0]!;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the original database error. */ }
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

  private async lockContact(client: PoolClient, id: string): Promise<ContactRow & { company_status: string } | null> {
    const result = await client.query<ContactRow & { company_status: string }>(`
      SELECT contact.contacto_id::text, contact.empresa_id::text, contact.tipo_contacto, contact.nombre,
        contact.area, contact.cargo, contact.observaciones, contact.estatus, contact.es_contacto_principal,
        company.estatus AS company_status
      FROM core.contactos contact
      JOIN core.empresas company ON company.empresa_id = contact.empresa_id
      WHERE contact.contacto_id = $1
      FOR UPDATE OF contact, company`, [id]);
    return result.rows[0] ?? null;
  }

  private contactChanges(contact: ContactRow, input: UpdateContactDto): Array<{ column: string; value: string | null }> {
    const changes: Array<{ column: string; value: string | null }> = [];
    if (contact.tipo_contacto === ContactType.Person) {
      if (input.name !== undefined) {
        if (!input.name) throw Object.assign(new Error('PERSON_NAME_REQUIRED'), { code: 'PERSON_NAME_REQUIRED' });
        changes.push({ column: 'nombre', value: input.name });
      }
      if (input.area !== undefined) changes.push({ column: 'area', value: input.area });
      if (input.position !== undefined) changes.push({ column: 'cargo', value: input.position });
    } else if (contact.tipo_contacto === ContactType.Area || contact.tipo_contacto === ContactType.GenericMailbox) {
      if (input.area !== undefined) {
        if (!input.area) throw Object.assign(new Error('CONTACT_AREA_REQUIRED'), { code: 'CONTACT_AREA_REQUIRED' });
        changes.push({ column: 'area', value: input.area });
      }
      if (input.name !== undefined && input.name !== null) throw Object.assign(new Error('CONTACT_NAME_NOT_ALLOWED'), { code: 'CONTACT_NAME_NOT_ALLOWED' });
      if (input.position !== undefined && input.position !== null) throw Object.assign(new Error('CONTACT_POSITION_NOT_ALLOWED'), { code: 'CONTACT_POSITION_NOT_ALLOWED' });
    } else {
      throw Object.assign(new Error('CONTACT_TYPE_NOT_EDITABLE'), { code: 'CONTACT_TYPE_NOT_EDITABLE' });
    }
    if (input.notes !== undefined) changes.push({ column: 'observaciones', value: input.notes });
    return changes;
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
